const express = require('express');
const cors = require('cors');
const PlaylistGetter = require('./playlist-getter');
const webutil = require('./webutil')
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;

const config_file = path.join(__dirname, '../config.json');
const metadata_file = path.join(__dirname, '../downloads.json');

fs.createWriteStream(config_file, { flags: 'a+' }).destroy();
const config = Object.assign({
  api_token: null,
  api_endpoint: "https://www.googleapis.com/youtube/v3",
  video_path: "public/downloads/videos",
  playlist_path: "public/downloads/playlists",
  temp_dir: "temp",
  max_simultaneous_downloads: 5,
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

  async function filter_async(array, predicate) {
    let filter_pass = await Promise.all(array.map(async el => [await predicate(el), el]));
    return filter_pass.filter(([pred, _]) => pred).map(([_, el]) => el);
  }

  async function update_saved_completions() {
    let completed_links = Object.keys(metadata).filter(link => metadata[link].status === 'finished');
    let existing_files = await filter_async(completed_links, async link => await access_bool(metadata[link].file, fs.constants.R_OK));
    let to_save = {};
    for (let link of existing_files)
      to_save[link] = metadata[link];
    await fsp.writeFile(metadata_file, JSON.stringify(to_save, null, 2));
  }

  function enqueue_link(link, options) {
    if (metadata[link] && metadata[link].status === 'finished')
      return Promise.resolve(metadata[link]);
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

              let video_data = await playlist_getter.download_video(
                active, 
                metadata[active].directory, 
                audio_only=(metadata[active].type === 'audio'),
                prefix=metadata[active].prefix);

              Object.assign(metadata[active], {
                status: 'finished',
                name: video_data.name,
                file: video_data.file
              });
              update_saved_completions();
              metadata[active].resolve(metadata[active]);

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
  let queue = [];
  let semaphore = config.max_simultaneous_downloads;

  if (fs.existsSync(metadata_file)) {
    metadata = require(metadata_file);
    update_saved_completions();
  }

  let app = express();
  app.use(cors());
  app.use(express.static('public'));
  app.use((req, res, next) => {
    if (req.path !== '/view_downloads')
      console.log(`${req.path}: ${JSON.stringify(req.query)}`);
    next();
  })

  webutil.get(app, "/download_video", ["url"], (req, res) => {
    if (!playlist_getter.valid_video_link(req.query.url)) {
      webutil.error(req, res, "Invalid-Link", "The given url is invalid");
    } else {
      enqueue_link(req.query.url, { type: req.query.audio_only === 'true' ? 'audio' : 'video' });
      webutil.success(req, res, {});
    }
  });

  webutil.get(app, "/download_playlist", ["url"], async (req, res) => {
    if (!playlist_getter.valid_playlist_link(req.query.url)) {
      webutil.error(req, res, "Invalid-Link", "The given url is invalid");
    } else {
      let { name, items } = await playlist_getter.playlist_data(req.query.url);
      let playlist_dir = path.join(config.playlist_path, clean(name));
      for (let i = 0; i < items.length; i++) {
        let link = items[i];
        enqueue_link(link, {
          type: req.query.audio_only === 'true' ? 'audio' : 'video',
          directory: playlist_dir,
          prefix: req.query.numbered === 'true' ? pad_num(i, items.length) + ". " : null
        });
      }
      webutil.success(req, res, {});
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

  app.get("/view_downloads", (req, res) => {
    webutil.success(req, res, Object.keys(metadata).map(link => {
      let result = {
        link: link,
        status: metadata[link].status
      };
      if (metadata[link].status === 'finished') {
        result.name = metadata[link].name;
        result.path = metadata[link].file.replace(/^public\//, "");
      } else if (metadata[link].status === 'failed') {
        result.error = metadata[link].error;
      }
      return result;
    }));
  });

  app.listen(config.port, () => {
    console.log(`Server hosting on port ${config.port}`);
  })
}

main();