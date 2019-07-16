const express = require('express');
const cors = require('cors');
const PlaylistGetter = require('./playlist-getter');
const webutil = require('./webutil')

const config = require('../config.json');

async function main() {
  
  let playlist_getter = await PlaylistGetter(config);

  let in_progress = {};
  let queue = [];
  let queue_active = false;

  function enqueue_link(link, options) {
    return new Promise((resolve, fail) => {
      in_progress[link] = Object.assign({
        status: 'queued',
        type: 'video',
        directory: config.video_path,
        resolve: resolve,
        fail: fail
      }, options);
      queue.push(link);
      (async () => {
        if (!queue_active) {
          queue_active = true;
          while (queue.length > 0) {
            let active = queue.shift();
            in_progress[active].status = 'downloading';
            try {
              console.log(`Downloading        ${active}`);
              let video_data = await playlist_getter.download_video(
                active, 
                in_progress[active].directory, 
                audio_only=(in_progress[active].type === 'audio'));
              console.log(`Finished           ${active} : '${video_data.name}'`);
              in_progress[active].status = 'finished';
              in_progress[active].name = video_data.name;
              in_progress[active].file = video_data.file;
              in_progress[active].resolve();
            } catch (err) {
              console.log(`Failed to download ${active} : ${err}`);
              in_progress[active].status = 'failed';
              in_progress[active].error = err;
              in_progress[active].fail(err);
            }
          }
          queue_active = false;
        }
      })();
    });
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
      enqueue_link(req.query.url, { type: 'video' });
      webutil.success(req, res, {});
    }
  });

  webutil.get(app, "/download_audio", ["url"], (req, res) => {
    if (!playlist_getter.valid_video_link(req.query.url)) {
      webutil.error(req, res, "Invalid-Link", "The given url is invalid");
    } else {
      enqueue_link(req.query.url, { type: 'audio' });
      webutil.success(req, res, {});
    }
  });

  app.get("/view_downloads", (req, res) => {
    webutil.success(req, res, Object.keys(in_progress).map(link => {
      let result = {
        link: link,
        status: in_progress[link].status
      };
      if (in_progress[link].status === 'finished') {
        result.name = in_progress[link].name;
        result.path = in_progress[link].file.replace(/^public\//, "");
      } else if (in_progress[link].status === 'failed') {
        result.error = in_progress[link].error;
      }
      return result;
    }));
  });

  app.listen(config.port, () => {
    console.log(`Server hosting on port ${config.port}`);
  })
}

main();