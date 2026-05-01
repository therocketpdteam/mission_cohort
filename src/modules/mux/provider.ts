import { env } from "@/lib/env";

export function getMuxPlaybackUrl(playbackId?: string | null) {
  return playbackId ? `https://stream.mux.com/${playbackId}.m3u8` : "";
}

export async function getMuxAsset(assetId: string) {
  if (!env.MUX_TOKEN_ID || !env.MUX_TOKEN_SECRET) {
    throw Object.assign(new Error("Mux is not configured. Add MUX_TOKEN_ID and MUX_TOKEN_SECRET."), {
      code: "BAD_REQUEST",
      status: 400
    });
  }

  const auth = Buffer.from(`${env.MUX_TOKEN_ID}:${env.MUX_TOKEN_SECRET}`).toString("base64");
  const response = await fetch(`https://api.mux.com/video/v1/assets/${assetId}`, {
    headers: { Authorization: `Basic ${auth}` }
  });

  if (!response.ok) {
    throw Object.assign(new Error(`Mux asset request failed with status ${response.status}`), {
      code: "BAD_REQUEST",
      status: 400
    });
  }

  return response.json() as Promise<Record<string, any>>;
}
