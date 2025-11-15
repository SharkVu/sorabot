import sys
import os
import yt_dlp
import json

# Tùy chỉnh logger để không in log ra stdout
class SilentLogger:
    def debug(self, msg):
        pass
    def warning(self, msg):
        pass
    def error(self, msg):
        pass

def download_youtube_video(url, format_type, output_path="downloads"):
    try:
        # Tạo thư mục đầu ra nếu chưa có
        os.makedirs(output_path, exist_ok=True)

        # Định dạng tên file đầu ra
        output_template = os.path.join(output_path, "%(title)s.%(ext)s")

        # Cấu hình yt-dlp
        ydl_opts = {
            "outtmpl": output_template,
            "noplaylist": True,
            "quiet": True,
            "no_warnings": True,
            "noprogress": True,
            "logger": SilentLogger(),
            # Nếu FFmpeg không trong PATH, bỏ comment dòng dưới và chỉ định đường dẫn
            # "ffmpeg_location": "C:\\ffmpeg\\bin\\ffmpeg.exe",
        }

        if format_type.lower() == "mp3":
            ydl_opts.update({
                "format": "bestaudio/best",
                "postprocessors": [{
                    "key": "FFmpegExtractAudio",
                    "preferredcodec": "mp3",
                    "preferredquality": "192",
                }],
            })
        elif format_type.lower() in ["mp4", "avi"]:
            ydl_opts.update({
                "format": "bestvideo+bestaudio/best",
                "merge_output_format": format_type.lower(),
            })

        # Tải video bằng yt-dlp
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=True)
            filename = ydl.prepare_filename(info).rsplit(".", 1)[0] + f".{format_type.lower()}"
            return {"success": True, "filename": filename, "title": info.get("title", "Unknown Title")}
    except Exception as e:
        return {"success": False, "error": str(e)}

if __name__ == "__main__":
    if len(sys.argv) != 3:
        result = {"success": False, "error": "Usage: python download.py <url> <format>"}
    else:
        url = sys.argv[1]
        format_type = sys.argv[2]
        result = download_youtube_video(url, format_type)
    
    # In JSON ra stdout
    print(json.dumps(result))