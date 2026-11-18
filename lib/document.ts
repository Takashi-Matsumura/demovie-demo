import { z } from "zod";

export const SCHEMA_VERSION = 1;

export const BACKGROUND_IDS = ["dusk", "ember", "slate", "paper"] as const;
export const BLUR_STYLES = ["mosaic", "solid"] as const;

export const DEFAULT_CHAPTER_SEC = 3;
export const MIN_CHAPTER_SEC = 1;
export const MAX_CHAPTER_SEC = 15;

// 手順の前に差し込むチャプター画面。チャプター名と補足を映す。その手順から始まる区切りとして手順に持たせる。
const chapterSchema = z.object({
  title: z.string(),
  note: z.string(),
  durationSec: z.number().min(MIN_CHAPTER_SEC).max(MAX_CHAPTER_SEC),
});

const clipSchema = z
  .object({
    id: z.string(),
    sourceStartSec: z.number().min(0),
    sourceEndSec: z.number().min(0),
    // 消す前に仕上がりを確かめられるよう、映像や説明文を残したまま再生と書き出しから外す。
    // この項目より前に保存した作業もそのまま読めるよう、省略できるようにしている。
    hidden: z.boolean().optional(),
    // 省略できるので、この項目より前に保存した作業もそのまま読める。
    chapter: chapterSchema.optional(),
  })
  .refine((clip) => clip.sourceEndSec > clip.sourceStartSec);

// ズームはタイムライン時刻ではなくクリップの素材時刻で持つ。並べ替えや分割でズレないようにするため。
const zoomSchema = z
  .object({
    id: z.string(),
    clipId: z.string(),
    sourceStartSec: z.number().min(0),
    sourceEndSec: z.number().min(0),
    depth: z.number().min(1.1).max(4),
    focusX: z.number().min(0).max(1),
    focusY: z.number().min(0).max(1),
  })
  .refine((zoom) => zoom.sourceEndSec > zoom.sourceStartSec);

// ズームと同じ理由で素材時刻で持つ。編集中に空にできるよう text は空文字を許す。
const captionSchema = z
  .object({
    id: z.string(),
    clipId: z.string(),
    sourceStartSec: z.number().min(0),
    sourceEndSec: z.number().min(0),
    text: z.string(),
  })
  .refine((caption) => caption.sourceEndSec > caption.sourceStartSec);

// クリップに紐づけず素材時刻で持つ。分割や並べ替えをしても、隠す場所が外れないようにするため。
const blurSchema = z
  .object({
    id: z.string(),
    sourceStartSec: z.number().min(0),
    sourceEndSec: z.number().min(0),
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
    width: z.number().positive().max(1),
    height: z.number().positive().max(1),
    style: z.enum(BLUR_STYLES).default("mosaic"),
  })
  .refine((blur) => blur.sourceEndSec > blur.sourceStartSec);

const narrationSchema = z.object({
  enabled: z.boolean(),
  voiceId: z.number().int(),
  voiceName: z.string(),
  speed: z.number().min(0.5).max(2),
  keepOriginalAudio: z.boolean(),
});

const DEFAULT_NARRATION = {
  enabled: false,
  voiceId: 13,
  voiceName: "青山龍星",
  speed: 1,
  keepOriginalAudio: false,
};

const lookSchema = z.object({
  background: z.enum(BACKGROUND_IDS),
  paddingPct: z.number().min(0).max(20),
  radiusPct: z.number().min(0).max(6),
  shadow: z.boolean(),
});

const assetSchema = z.object({
  name: z.string(),
  durationSec: z.number().positive(),
  width: z.number().positive(),
  height: z.number().positive(),
});

export const documentSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  asset: assetSchema,
  purpose: z.string(),
  clips: z
    .array(clipSchema)
    .min(1)
    .refine(
      (clips) => clips.some((clip) => !clip.hidden),
      "動画に含める手順が 1 つ以上必要です。",
    ),
  zooms: z.array(zoomSchema),
  captions: z.array(captionSchema),
  // この項目より前に保存した作業を読み込めるよう、既定値を持たせる。
  blurs: z.array(blurSchema).default([]),
  narration: narrationSchema.default(DEFAULT_NARRATION),
  look: lookSchema,
});

export type DemoDocument = z.infer<typeof documentSchema>;
export type Clip = z.infer<typeof clipSchema>;
export type Chapter = z.infer<typeof chapterSchema>;
export type Zoom = z.infer<typeof zoomSchema>;
export type Caption = z.infer<typeof captionSchema>;
export type Blur = z.infer<typeof blurSchema>;
export type Narration = z.infer<typeof narrationSchema>;
export type Look = z.infer<typeof lookSchema>;
export type Asset = z.infer<typeof assetSchema>;

export function newId() {
  return crypto.randomUUID();
}

export function createDocument(asset: Asset): DemoDocument {
  return {
    schemaVersion: SCHEMA_VERSION,
    asset,
    purpose: "",
    clips: [
      { id: newId(), sourceStartSec: 0, sourceEndSec: asset.durationSec },
    ],
    zooms: [],
    captions: [],
    blurs: [],
    narration: DEFAULT_NARRATION,
    look: { background: "dusk", paddingPct: 6, radiusPct: 2, shadow: true },
  };
}
