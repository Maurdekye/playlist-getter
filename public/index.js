let url_input = document.getElementById('url_input');
let downloads_progress = document.getElementById('downloads_progress');
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

async function download_playlist() {
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

  let html = `
    <table>
      <tr>
        <td><b>URL</b></td>
        <td><b>Status</b></td>
        <td><b>Name</b></td>
        <td><b>Download Link</b></td>
      </tr>`;

  for (let item of result.result) {
    let down_link = item.path ? `<a href="${item.path}" download>Download</a>` : "";
    if (item.status === 'failed')
      down_link = `<input type="button" value="Retry" onclick="retry_download('${item.link}')">`;
    html += `
      <tr>
        <td><a href='${item.link}'>${item.link}</a></td>
        <td>${item.status}</td>
        <td>${item.name ? item.name : ""}</td>
        <td>${down_link}</td>
      </tr>`;
  }
  html += `</table>`;
  downloads_progress.innerHTML = html;
}

populate_downloaded_list();
setInterval(populate_downloaded_list, 1000);