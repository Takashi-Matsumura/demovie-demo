import { z } from "zod";

export const SCHEMA_VERSION = 1;

export const BACKGROUND_IDS = ["dusk", "ember", "slate", "paper"] as const;

const clipSchema = z
  .object({
    id: z.string(),
    sourceStartSec: z.number().min(0),
    sourceEndSec: z.number().min(0),
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
  clips: z.array(clipSchema).min(1),
  zooms: z.array(zoomSchema),
  captions: z.array(captionSchema),
  look: lookSchema,
});

export type DemoDocument = z.infer<typeof documentSchema>;
export type Clip = z.infer<typeof clipSchema>;
export type Zoom = z.infer<typeof zoomSchema>;
export type Caption = z.infer<typeof captionSchema>;
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
    look: { background: "dusk", paddingPct: 6, radiusPct: 2, shadow: true },
  };
}
