const ytdl = require('ytdl-core');
const ffmpeg = require('fluent-ffmpeg');
const path = require('path');
const fs = require('fs').promises;
const os = require('os');

async function downloadYouTubeVideo(url, format, outputPath = 'downloads') {
  try {
    // Tạo thư mục đầu ra nếu chưa có
    await fs.mkdir(outputPath, { recursive: true });

    // Lấy thông tin video
    const info = await ytdl.getInfo(url);
    const title = info.videoDetails.title.replace(/[^a-zA-Z0-9]/g, '_'); // Làm sạch tiêu đề
    const filename = path.join(outputPath, `${title}.${format.toLowerCase()}`);

    // Kiểm tra FFmpeg
    ffmpeg.setFfmpegPath(require('ffmpeg-static')); // Sử dụng ffmpeg-static để tự động cung cấp FFmpeg

    return new Promise((resolve, reject) => {
      const stream = ytdl(url, {
        quality: format.toLowerCase() === 'mp3' ? 'highestaudio' : 'highest',
      });

      const ffmpegProcess = ffmpeg(stream);

      if (format.toLowerCase() === 'mp3') {
        ffmpegProcess
          .audioBitrate(192)
          .toFormat('mp3')
          .output(filename)
          .on('end', async () => {
            // Kiểm tra kích thước file
            const stats = await fs.stat(filename).catch(() => null);
            if (!stats || stats.size > 8 * 1024 * 1024) {
              await fs.unlink(filename).catch(() => {});
              return reject(new Error('File size exceeds 8MB limit'));
            }
            resolve({
              success: true,
              filename,
              title: info.videoDetails.title,
            });
          })
          .on('error', (err) => reject(new Error(`FFmpeg error: ${err.message}`)));
      } else if (format.toLowerCase() === 'mp4' || format.toLowerCase() === 'avi') {
        ffmpegProcess
          .toFormat(format.toLowerCase())
          .output(filename)
          .on('end', async () => {
            // Kiểm tra kích thước file
            const stats = await fs.stat(filename).catch(() => null);
            if (!stats || stats.size > 8 * 1024 * 1024) {
              await fs.unlink(filename).catch(() => {});
              return reject(new Error('File size exceeds 8MB limit'));
            }
            resolve({
              success: true,
              filename,
              title: info.videoDetails.title,
            });
          })
          .on('error', (err) => reject(new Error(`FFmpeg error: ${err.message}`)));
      } else {
        return reject(new Error('Unsupported format'));
      }

      ffmpegProcess.run();
    });
  } catch (error) {
    return {
      success: false,
      error: error.message,
    };
  }
}

module.exports = { downloadYouTubeVideo };