const express = require('express');
const cors = require('cors');
const PlaylistGetter = require('./playlist-getter');
const webutil = require('./webutil')
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const archiver = require('archiver');

const config_file = path.join(__dirname, '../config.json');
const metadata_file = path.join(__dirname, '../downloads.json');
const playlist_file = path.join(__dirname, '../playlist_downloads.json');

fs.createWriteStream(config_file, { flags: 'a+' }).destroy();
const config = Object.assign({
  api_token: null,
  api_endpoint: "https://www.googleapis.com/youtube/v3",
  video_path: "public/downloads/videos",
  playlist_path: "public/downloads/playlists",
  zipped_playlist_path: "public/downloads/zipped-playlists",
  temp_dir: "temp",
  max_simultaneous_downloads: 5,
  client_poll_rate: 3000,
  port: 80
}, require(config_file));
fs.writeFileSync(config_file, JSON.stringify(config, null, 2));

function clean(str) {
  return str.replace(/[\/\\:?*"<>|]/g, "");
}

function pad_num(num, size) {
  return ((num + 1) + "").padStart((size + "").length, '0');
}

async function main() {

  async function access_bool(path, mode=fs.constants.F_OK) {
    try {
      await fsp.access(path, mode);
      return true;
    } catch (err) {
      return false;
    }
  }

  async function clear_removed_files() {
    for (let link of Object.keys(metadata)) {
      if (metadata[link].status === 'finished' && !(await access_bool(metadata[link].file, fs.constants.R_OK)))
        delete metadata[link];
    }
    for (let link of Object.keys(playlists)) {
      if (playlists[link].status === 'finished' && !(await access_bool(playlists[link].file, fs.constants.R_OK)))
        delete playlists[link];
    }
  }

  async function update_saved_completions() {
    await clear_removed_files();
    let to_save = {};
    for (let link of Object.keys(metadata)) {
      if (metadata[link].status === 'finished')
        to_save[link] = metadata[link];
    }
    await fsp.writeFile(metadata_file, JSON.stringify(to_save, null, 2));
  }

  async function update_saved_completed_playlists() {
    await clear_removed_files();
    let to_save = {};
    for (let link of Object.keys(playlists)) {
      if (playlists[link].status === 'finished')
        to_save[link] = playlists[link];
    }
    await fsp.writeFile(playlist_file, JSON.stringify(to_save, null, 2));
  }

  function enqueue_link(link, options) {
    if (metadata[link] && metadata[link].status === 'finished') {
      if (options.playlist_resolve)
        options.playlist_resolve();
      return Promise.resolve(metadata[link]);
    }
    metadata[link] = Object.assign({
      status: 'queued',
      type: 'video',
      directory: config.video_path
    }, options);
    queue.push(link);
    return new Promise((resolve, fail) => {
      Object.assign(metadata[link], {
        resolve: resolve,
        fail: fail
      });
      (async () => {
        if (semaphore > 0) {
          semaphore -= 1;
          while (queue.length > 0) {
            let active = queue.shift();
            metadata[active].status = 'downloading';
            try {

              let { file } = await playlist_getter.download_video(
                active, 
                metadata[active].directory, 
                audio_only=(metadata[active].type === 'audio'),
                prefix=metadata[active].prefix);

              Object.assign(metadata[active], {
                status: 'finished',
                file: file
              });
              update_saved_completions();
              metadata[active].resolve(metadata[active]);
              if (metadata[active].playlist_resolve)
                metadata[active].playlist_resolve();

            } catch (err) {
              Object.assign(metadata[active], {
                status: 'failed',
                error: err
              });
              metadata[active].fail(err);
            }
          }
          semaphore += 1;
        }
      })();
    });
  }
  
  let playlist_getter = await PlaylistGetter(config);

  let metadata = {};
  let playlists = {};
  let queue = [];
  let semaphore = config.max_simultaneous_downloads;

  if (fs.existsSync(metadata_file)) {
    metadata = require(metadata_file);
  }

  if (fs.existsSync(playlist_file)) {
    playlists = require(playlist_file);
  }

  clear_removed_files();

  let app = express();
  app.use(cors());
  app.use(express.static('public'));
  app.use((req, res, next) => {
    if (req.path !== '/view_downloads')
      console.log(`${req.path}: ${JSON.stringify(req.query)}`);
    next();
  })

  webutil.get(app, "/download_video", ["url"], async (req, res) => {
    if (!playlist_getter.valid_video_link(req.query.url)) {
      webutil.error(req, res, "Invalid-Link", "Not a valid video link");
    } else {
      enqueue_link(req.query.url, { 
        type: req.query.audio_only === 'true' ? 'audio' : 'video',
        name: await playlist_getter.get_video_name(req.query.link)
      });
      webutil.success(req, res, {});
    }
  });

  webutil.get(app, "/download_playlist", ["url"], async (req, res) => {
    if (!playlist_getter.valid_playlist_link(req.query.url)) {
      webutil.error(req, res, "Invalid-Link", "Not a valid playlist link");
    } else {

      let { name, items } = await playlist_getter.playlist_data(req.query.url);
      let playlist_dir = path.join(config.playlist_path, clean(name));
      playlists[req.query.url] = {
        status: 'downloading',
        directory: path.join(config.playlist_path, clean(name)),
        file: path.join(config.zipped_playlist_path, clean(name)) + ".zip",
        name: name,
        item_status: {}
      };
      
      webutil.success(req, res, {});

      let completed_items = await Promise.all(items.map(async (link, i) => {
        playlists[req.query.url].item_status[link] = 'downloading';
        await new Promise(async resolve => {
          let prefix = req.query.numbered === 'true' ? pad_num(i, items.length) + ". " : "";
          let name = prefix + await playlist_getter.get_video_name(link);
          let result = await enqueue_link(link, {
            type: req.query.audio_only === 'true' ? 'audio' : 'video',
            directory: playlist_dir,
            name: name,
            prefix: prefix,
            playlist_resolve: resolve
          });
        });
        playlists[req.query.url].item_status[link] = 'finished';
      }));

      playlists[req.query.url].status = 'zipping';

      await fsp.mkdir(config.zipped_playlist_path, { recursive: true });

      await new Promise(resolve => {
        let archive = archiver('zip');
        archive.pipe(fs.createWriteStream(playlists[req.query.url].file));
        for (let link of Object.keys(playlists[req.query.url].item_status)) {
          archive.file(metadata[link].file, {name: path.basename(metadata[link].file)});
        }
        archive.on('end', resolve);
        archive.finalize();
      });

      playlists[req.query.url].status = 'finished';
      update_saved_completed_playlists();
    }
  });

  webutil.get(app, "/retry_download", ["url"], (req, res) => {
    if (Object.keys(metadata).filter(link => metadata[link].status === 'failed').indexOf(req.query.url) == -1) {
      webutil.error(req, res, "Unused-Link", "This link is not responsible for any failed downloads");
    } else {
      enqueue_link(req.query.url, metadata[req.query.url]);
      webutil.success(req, res, {});
    }
  });

  app.get("/view_downloads", async (req, res) => {
    await clear_removed_files();
    webutil.success(req, res, {
      downloads: Object.keys(metadata).map(link => {
        let result = {
          link: link,
          status: metadata[link].status,
          name: metadata[link].name
        };
        if (metadata[link].status === 'finished') {
          result.path = metadata[link].file.replace(/^public\//, "");
        } else if (metadata[link].status === 'failed') {
          result.error = metadata[link].error;
        }
        return result;
      }),
      playlists: Object.keys(playlists).map(link => {
        let result = {
          link: link,
          status: playlists[link].status,
          name: playlists[link].name,
          size: Object.keys(playlists[link].item_status).length,
          ready_count: Object.values(playlists[link].item_status).filter(s => s === 'finished').length
        };
        if (playlists[link].status === 'finished') {
          result.path = playlists[link].file.replace(/^public\//, "");
        }
        return result;
      }),
      poll_rate: config.client_poll_rate
    });
  });

  app.listen(config.port, () => {
    console.log(`Server hosting on port ${config.port}`);
  })
}

main();