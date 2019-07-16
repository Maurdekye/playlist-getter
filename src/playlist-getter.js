const ytdl = require('ytdl-core');
const querystring = require('querystring');
const fetch = require('node-fetch');
const path = require('path');
const ffmpeg = require('fluent-ffmpeg');
const fsSync = require('fs');
const fs = fsSync.promises;

function dissect_link(url) {
  let null_result = {
    video_id: null,
    playlist_id: null
  };
  try {
    let components = new URL(url);
    if (components.hostname === 'youtu.be') {
      return {
        video_id: components.pathname.substr(1),
        playlist_id: null
      }
    } else if (components.hostname === 'www.youtube.com') {
      return {
        video_id: components.searchParams.get('v'),
        playlist_id: components.searchParams.get('list')
      };
    } else {
      return null_result;
    }
  } catch (err) {
    return null_result;
  }
}

function clean(str) {
  return str.replace(/\/\\:\?\*"<>\|/g, "");
}

const codec_translations = {
  'H.264': 'libx264'
};

module.exports = async config => {
  config = Object.assign({
    api_token: null,
    api_endpoint: "https://www.googleapis.com/youtube/v3",
    video_path: "public/downloads/videos",
    playlist_path: "public/downloads/playlists",
    temp_dir: "temp"
  }, config);

  if (!config.api_token) {
    throw "Youtube api token missing";
  }
      
  await fs.mkdir(config.temp_dir, { recursive: true });

  function prepare_api_query(endpoint, query_parameters) {
    let call = config.api_endpoint + endpoint + "?" + querystring.stringify(Object.assign(query_parameters, {key: config.api_token}));
    // console.log("API Call: " + call);
    return call;
  }

  async function fetch_api_query(endpoint, query_parameters) {
    let result = await (await fetch(prepare_api_query(endpoint, query_parameters))).json();
    if (result.error)
      throw new Error(result.error.message);
    return result;
  }

  let self = {
    valid_video_link: link => {
      let link_data = dissect_link(link);
      return link_data.video_id !== null;
    },

    valid_playlist_link: link => {
      let link_data = dissect_link(link);
      return link_data.playlist_id !== null;
    },

    download_video: async (link, directory, audio_only=false, prefix=null) => {
      await fs.mkdir(directory, { recursive: true });

      let video_id = dissect_link(link).video_id;
      if (video_id === null)
        throw new Error("Invalid video link");

      let result = await fetch_api_query("/videos", {
        part: 'snippet',
        id: video_id
      });

      let video_name = result.items[0].snippet.title;
      if (prefix)
        video_name = prefix + video_name;
      let clean_vname = clean(video_name);
      let base_file_path = path.join(directory, clean_vname);

      if (audio_only) {
        let file_path = base_file_path + ".mp3";
        await new Promise((resolve, fail) => {
          ytdl(link, {
            quality: 'highestaudio',
            filter: 'audioonly'
          }).pipe(fsSync.createWriteStream(file_path))
            .on('finish', resolve)
            .on('error', fail);
        });
        return {
          file: file_path,
          name: video_name
        };
      } else {
        let file_path = base_file_path + ".mp4";
        let temp_dir = await fs.mkdtemp(path.join(config.temp_dir, `video-${clean(video_id)}-`));
        let temp_audio = path.join(temp_dir, "audio");
        let temp_video = path.join(temp_dir, "video");
        let audio_encoding = null;
        let video_encoding = null;
        await Promise.all([ 
          new Promise((resolve, fail) => {
            ytdl(link, {
              quality: 'highestaudio',
              filter: 'audioonly'
            }).on('info', (err, info) => audio_encoding = info.audioEncoding)
              .pipe(fsSync.createWriteStream(temp_audio))
              .on('finish', resolve)
              .on('error', fail);
          }),
          new Promise((resolve, fail) => {
            ytdl(link, {
              quality: 'highestvideo',
              filter: 'videoonly'
            }).on('info', (err, info) => video_encoding = info.encoding)
              .pipe(fsSync.createWriteStream(temp_video))
              .on('finish', resolve)
              .on('error', fail);
          })
        ]);
        video_encoding = codec_translations[video_encoding] || video_encoding;
        audio_encoding = codec_translations[audio_encoding] || audio_encoding;
        await new Promise((resolve, fail) => {
          ffmpeg()
            .input(temp_video)
            .videoCodec(video_encoding)
            .input(temp_audio)
            .audioCodec(audio_encoding)
            .save(file_path)
            .on('end', resolve)
            .on('error', fail);
        });
        Promise.all([
          fs.unlink(temp_video),
          fs.unlink(temp_audio)
        ]).then(() => fs.rmdir(temp_dir));
        return {
          file: file_path,
          name: video_name
        };
      }
    },

    playlist_data: async link => {
      let playlist_id = dissect_link(link).playlist_id;
      if (playlist_id === null)
        throw new Error("Invalid playlist link");

      let items = [];

      var result = {};
      do {
        let query_args = {
          part: 'contentDetails',
          maxResults: 50,
          playlistId: playlist_id
        };
        if (result.nextPageToken)
          query_args.pageToken = result.nextPageToken;
        result = await fetch_api_query("/playlistItems", query_args);
        items = items.concat(result.items.map(item => `https://www.youtube.com/watch?v=${item.contentDetails.videoId}`));
      } while (result.nextPageToken);

      result = await fetch_api_query("/playlists", {
        part: 'snippet',
        id: playlist_id
      });

      return {
        name: result.items[0].snippet.title,
        items: items
      };
    }
    
  };

  return self;
};