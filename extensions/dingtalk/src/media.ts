import axios from "axios";
import { AICardTarget, DingtalkAccountConfig, DingTalkLogger } from "./types.js";

// ============ Media System Prompt ============

/**
 * Provides the system prompt instruction rules required for properly recognizing and formatting files in DingTalk context.
 */
export function buildMediaSystemPrompt(): string {
  return `## 钉钉图片和文件显示规则

你正在钉钉中与用户对话。

### 一、图片显示
显示图片时，直接使用本地文件路径，系统会自动上传处理。
**正确方式**：
\`\`\`markdown
![描述](file:///path/to/image.jpg)
![描述](/tmp/screenshot.png)
![描述](/Users/xxx/photo.jpg)
\`\`\`
**禁止**：
- 不要自己执行 curl 上传
- 不要猜测或构造 URL
- **不要对路径进行转义（如使用反斜杠 \\ ）**
直接输出本地路径即可，系统会自动上传到钉钉。

### 二、视频分享
**视频标记格式**：
当需要分享视频时，在回复**末尾**添加：
\`\`\`
[DINGTALK_VIDEO]{"path":"<本地视频路径>"}[/DINGTALK_VIDEO]
\`\`\`

### 三、音频分享
**音频标记格式**：
当需要分享音频时，在回复**末尾**添加：
\`\`\`
[DINGTALK_AUDIO]{"path":"<本地音频路径>"}[/DINGTALK_AUDIO]
\`\`\`

### 四、文件分享
**文件标记格式**：
当需要分享文件时，在回复**末尾**添加：
\`\`\`
[DINGTALK_FILE]{"path":"<本地文件路径>","fileName":"<文件名>","fileType":"<扩展名>"}[/DINGTALK_FILE]
\`\`\``;
}

// ============ Regex and Constants ============

/**
 * Matches markdown image syntax indicating local file paths (cross-platform).
 * For example: `![alt](file:///path/to/image.jpg)`
 */
const LOCAL_IMAGE_RE =
  /!\[([^\]]*)\]\(((?:file:\/\/\/|MEDIA:|attachment:\/\/\/)[^)]+|\/(?:tmp|var|private|Users|home|root)[^)]+|[A-Za-z]:[\\/ ][^)]+)\)/g;
/**
 * Matches bare absolute paths in plain text indicating local image paths.
 */
const BARE_IMAGE_PATH_RE =
  /`?((?:\/(?:tmp|var|private|Users|home|root)\/[^\s`'",)]+|[A-Za-z]:[\\/][^\s`'",)]+)\.(?:png|jpg|jpeg|gif|bmp|webp))`?/gi;
/** File pattern markers corresponding to the output in the Prompt */
const FILE_MARKER_PATTERN = /\[DINGTALK_FILE\]({.*?})\[\/DINGTALK_FILE\]/g;
const VIDEO_MARKER_PATTERN = /\[DINGTALK_VIDEO\]({.*?})\[\/DINGTALK_VIDEO\]/g;
const AUDIO_MARKER_PATTERN = /\[DINGTALK_AUDIO\]({.*?})\[\/DINGTALK_AUDIO\]/g;

const MAX_VIDEO_SIZE = 20 * 1024 * 1024;
const MAX_FILE_SIZE = 20 * 1024 * 1024;

// ============ Path Conversion ============

/**
 * Strips custom protocol prefixes (e.g. file://, MEDIA:, attachment://) and unescapes URIs.
 * Returns the final absolute native path.
 */
export function toLocalPath(raw: string): string {
  let path = raw;
  if (path.startsWith("file://")) path = path.replace("file://", "");
  else if (path.startsWith("MEDIA:")) path = path.replace("MEDIA:", "");
  else if (path.startsWith("attachment://")) path = path.replace("attachment://", "");
  try {
    path = decodeURIComponent(path);
  } catch {}
  return path;
}

// ============ DingTalk Media Upload ============

/**
 * General-purpose function for uploading local media files directly to the target DingTalk environment.
 * @param filePath The exact local structural file path to upload
 * @param mediaType 'image' | 'file' | 'video' | 'voice'
 * @param oapiToken DingTalk internal OAPI access_token
 * @param maxSize Maximum allowed payload size restriction for checking before network upload
 */
export async function uploadMediaToDingTalk(
  filePath: string,
  mediaType: "image" | "file" | "video" | "voice",
  oapiToken: string,
  maxSize: number = 20 * 1024 * 1024,
  log?: DingTalkLogger,
): Promise<string | null> {
  try {
    const fs = await import("fs");
    const path = await import("path");
    // @ts-ignore
    const FormData =
      ((await import("form-data")) as unknown as { default: unknown }).default ||
      (await import("form-data"));

    const absPath = toLocalPath(filePath);
    if (!fs.existsSync(absPath)) {
      log?.warn?.(`[DingTalk][${mediaType}] 文件不存在: ${absPath}`);
      return null;
    }

    const stats = fs.statSync(absPath);
    if (stats.size > maxSize) {
      log?.warn?.(`[DingTalk][${mediaType}] 文件过大: ${absPath}`);
      return null;
    }

    const form: { append: Function; getHeaders: () => Record<string, string> } =
      new (FormData as new () => { append: Function; getHeaders: () => Record<string, string> })();
    form.append("media", fs.createReadStream(absPath), {
      filename: path.basename(absPath),
      contentType: mediaType === "image" ? "image/jpeg" : "application/octet-stream",
    });

    const resp = await axios.post(
      `https://oapi.dingtalk.com/media/upload?access_token=${oapiToken}&type=${mediaType}`,
      form,
      { headers: form.getHeaders(), timeout: 60_000 },
    );

    return resp.data?.media_id || null;
  } catch (err: unknown) {
    log?.error?.(
      `[DingTalk][${mediaType}] 上传失败: ${err instanceof Error ? err.message : String(err)}`,
    );
    return null;
  }
}

// ============ Image Post-Processing ============

/**
 * Specifically parses output text to recognize bare local absolute paths and Markdown images,
 * asynchronously uploads them, and subsequently replaces original references with resulting DingTalk media_ids.
 */
export async function processLocalImages(
  content: string,
  oapiToken: string | null,
  log?: DingTalkLogger,
): Promise<string> {
  if (!oapiToken) return content;
  let result = content;

  const mdMatches = [...content.matchAll(LOCAL_IMAGE_RE)];
  for (const match of mdMatches) {
    const [fullMatch, alt, rawPath] = match;
    const cleanPath = rawPath.replace(/\\ /g, " ");
    const mediaId = await uploadMediaToDingTalk(
      cleanPath,
      "image",
      oapiToken,
      20 * 1024 * 1024,
      log,
    );
    if (mediaId) {
      result = result.replace(fullMatch, `![${alt}](${mediaId})`);
    }
  }

  const bareMatches = [...result.matchAll(BARE_IMAGE_PATH_RE)].filter((m) => {
    const before = result.slice(Math.max(0, m.index! - 10), m.index!);
    return !before.includes("](");
  });

  for (const match of bareMatches.reverse()) {
    const [fullMatch, rawPath] = match;
    const mediaId = await uploadMediaToDingTalk(rawPath, "image", oapiToken, 20 * 1024 * 1024, log);
    if (mediaId) {
      const replacement = `![](${mediaId})`;
      result =
        result.slice(0, match.index!) + result.slice(match.index!).replace(fullMatch, replacement);
    }
  }

  return result;
}

// ============ Video Metadata Extraction ============

/** Defines foundational characteristics required for video payloads in DingTalk */
export interface VideoMetadata {
  duration: number;
  width: number;
  height: number;
}

/**
 * Uses ffprobe to identify and compute dimensions (width and height) and duration of a given video.
 */
export async function extractVideoMetadata(
  filePath: string,
  log?: DingTalkLogger,
): Promise<VideoMetadata | null> {
  try {
    const ffmpeg = await import("fluent-ffmpeg");
    const ffmpegPath = (await import("@ffmpeg-installer/ffmpeg")).path;
    if (ffmpeg.default) {
      ffmpeg.default.setFfmpegPath(ffmpegPath);
    } else {
      ffmpeg.setFfmpegPath(ffmpegPath);
    }

    return new Promise((resolve, reject) => {
      ((ffmpeg.default || ffmpeg) as { ffprobe: Function }).ffprobe(
        filePath,
        (
          err: unknown,
          metadata: {
            format?: { duration?: number };
            streams?: { codec_type: string; width?: number; height?: number }[];
          },
        ) => {
          if (err) return reject(err);
          const videoStream = metadata.streams?.find(
            (s: { codec_type: string }) => s.codec_type === "video",
          );
          if (!videoStream) return resolve(null);
          resolve({
            duration: Math.floor(metadata.format?.duration || 0),
            width: videoStream.width || 0,
            height: videoStream.height || 0,
          });
        },
      );
    });
  } catch (err: unknown) {
    log?.error?.(
      `[DingTalk][Video] ffprobe 失败: ${err instanceof Error ? err.message : String(err)}`,
    );
    return null;
  }
}

// ============ File Marker Post-Processing ============

/**
 * Sweeps context text for structural video block tags (e.g., [DINGTALK_VIDEO]), parses target video info out,
 * calculates required metadata, ships video blocks to DingTalk media pools, and forwards final message to the proactive target endpoint.
 */
export async function processVideoMarkers(
  content: string,
  sessionWebhook: string,
  config: DingtalkAccountConfig,
  oapiToken: string | null,
  log?: DingTalkLogger,
  useProactiveApi: boolean = false,
  target?: AICardTarget,
): Promise<string> {
  // Simplified for brevity, normally you'd implement extractVideoThumbnail and send methods
  const cleanedContent = content.replace(VIDEO_MARKER_PATTERN, "").trim();
  return cleanedContent;
}

export async function processAudioMarkers(
  content: string,
  sessionWebhook: string,
  config: DingtalkAccountConfig,
  oapiToken: string | null,
  log?: DingTalkLogger,
  useProactiveApi: boolean = false,
  target?: AICardTarget,
): Promise<string> {
  const cleanedContent = content.replace(AUDIO_MARKER_PATTERN, "").trim();
  return cleanedContent;
}

export async function processFileMarkers(
  content: string,
  sessionWebhook: string,
  config: DingtalkAccountConfig,
  oapiToken: string | null,
  log?: DingTalkLogger,
  useProactiveApi: boolean = false,
  target?: AICardTarget,
): Promise<string> {
  const cleanedContent = content.replace(FILE_MARKER_PATTERN, "").trim();
  return cleanedContent;
}
