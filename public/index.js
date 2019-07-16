let url_input = document.getElementById('url_input');
let downloads_progress = document.getElementById('downloads_progress');
let playlists_progress = document.getElementById('playlists_progress');
let download_feedback = document.getElementById('download_feedback');
let audio_only = document.getElementById('audio_only');
let numbered = document.getElementById('numbered');

async function give_feedback(message, positive) {
  download_feedback.innerHTML = message;
  download_feedback.className = positive ? "positive-feedback" : "negative-feedback";
  await new Promise(res => setTimeout(res, 4000));
  download_feedback.innerHTML = "";
}

async function download_video() {
  if (!url_input.value) {
    give_feedback("Paste a video link first", false);
  } else {
    let call = `/download_video?url=${encodeURIComponent(url_input.value)}&audio_only=${audio_only.checked}`;
    let response = await fetch(call);
    let result = await response.json();
    if (!result.success) {
      give_feedback(result.errorMessage, false);
      throw new Error(`${result.error}: ${result.errorMessage}`);
    } else {
      give_feedback("Download initialized", true);
      populate_downloaded_list();
      url_input.value = "";
    }
  }
}

async function download_playlist() {
  if (!url_input.value) {
    give_feedback("Paste a playlist link first", false);
  } else {
    let call = `/download_playlist?url=${encodeURIComponent(url_input.value)}&audio_only=${audio_only.checked}&numbered=${numbered.checked}`;
    let response = await fetch(call);
    let result = await response.json();
    if (!result.success) {
      give_feedback(result.errorMessage, false);
      throw new Error(`${result.error}: ${result.errorMessage}`);
    } else {
      give_feedback("Download initialized", true);
      populate_downloaded_list();
      url_input.value = "";
    }
  }
}

async function retry_download(link) {
  let call = `/retry_download?url=${encodeURIComponent(link)}`;
  let response = await fetch(call);
  let result = await response.json();
  if (!result.success) {
    throw new Error(`${result.error}: ${result.errorMessage}`);
  } else {
    populate_downloaded_list();
  }
}

async function populate_downloaded_list() {
  let response = await fetch('/view_downloads');
  let result = await response.json();
  if (result.error)
    throw new Error(result.errorMessage);

  let downloads_html = `
    <table>
      <tr>
        <td><b>Link</b></td>
        <td><b>Name</b></td>
        <td><b>Status</b></td>
        <td><b>Download Link</b></td>
      </tr>`;

  for (let item of result.result.downloads) {
    let download_link = item.path ? `<a href="${item.path}" download>Download</a>` : "";
    if (item.status === 'failed')
      download_link = `<input type="button" value="Retry" onclick="retry_download('${item.link}')">`;
    downloads_html += `
      <tr>
        <td><a href='${item.link}'>${item.link}</a></td>
        <td>${item.name ? item.name : ""}</td>
        <td>${item.status}</td>
        <td>${download_link}</td>
      </tr>`;
  }
  downloads_html += `</table>`;
  downloads_progress.innerHTML = downloads_html;

  let playlists_html = `
    <table>
      <tr>
        <td><b>Link</b></td>
        <td><b>Name</b></td>
        <td><b>Status</b></td>
        <td><b>Progress</b></td>
        <td><b>Download Link</b></td>
      </tr>`;

  for (let item of result.result.playlists) {
    let download_link = item.path ? `<a href="${item.path}" download>Download ZIP</a>` : "";
    playlists_html += `
      <tr>
        <td><a href="${item.link}">${item.link}</a></td>
        <td>${item.name}</td>
        <td>${item.status}</td>
        <td>${item.ready_count}/${item.size}</td>
        <td>${download_link}</td>
      </tr>`;
  }
  playlists_html += `</table>`;
  playlists_progress.innerHTML = playlists_html;
}

populate_downloaded_list();
(async () => {
  let response = await fetch(`/view_downloads`);
  let result = await response.json();
  setInterval(populate_downloaded_list, result.result.poll_rate);
})();
