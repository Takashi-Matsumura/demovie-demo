// HDMI キャプチャ機器など、OS からカメラとして見える映像入力を扱う。
// BIOS のように画面録画ソフトが動かない画面を、別の PC から録画するために使う。

export type CaptureDevice = { deviceId: string; label: string };

// PC に最初から付いているカメラ。キャプチャ機器を既定で選ぶため、候補の後ろへ回す。
const BUILT_IN_CAMERA = /facetime|integrated|built-?in|内蔵|webcam|front|back camera/i;

/** 既定で選ぶ機器。内蔵カメラ以外があればそれを優先する。 */
export function preferCaptureDevice(devices: CaptureDevice[]): CaptureDevice | undefined {
  return devices.find((device) => !BUILT_IN_CAMERA.test(device.label)) ?? devices[0];
}

/** 映像入力と同じ機器の音声入力。無ければ録音しない（部屋のマイクを拾わないため）。 */
export function pairedAudioInput(
  devices: Pick<MediaDeviceInfo, "kind" | "deviceId" | "groupId">[],
  videoDeviceId: string,
) {
  const groupId = devices.find(
    (device) => device.kind === "videoinput" && device.deviceId === videoDeviceId,
  )?.groupId;
  if (!groupId) return undefined;
  return devices.find((device) => device.kind === "audioinput" && device.groupId === groupId);
}

export function captureErrorMessage(cause: unknown) {
  if (cause instanceof DOMException) {
    switch (cause.name) {
      case "NotAllowedError":
        return "カメラの使用が許可されていません。アドレスバーの設定からカメラを許可してください。";
      case "NotFoundError":
      case "OverconstrainedError":
        return "キャプチャ機器が見つかりません。USB の接続を確認してください。";
      case "NotReadableError":
        return "キャプチャ機器を開けませんでした。OBS など、他のアプリが使っていないか確認してください。";
    }
  }
  return cause instanceof Error ? cause.message : "キャプチャ機器を開けませんでした。";
}

export async function listCaptureDevices(): Promise<CaptureDevice[]> {
  const media = navigator.mediaDevices;
  if (!media?.getUserMedia) {
    throw new Error("このブラウザはキャプチャ機器に対応していません。デスクトップ版の Chrome か Edge を使ってください。");
  }
  let devices = await media.enumerateDevices();
  // 許可前は機器の名前が空になる。一度だけ許可を求めて、名前付きで取り直す。
  if (devices.some((device) => device.kind === "videoinput" && !device.label)) {
    const probe = await media.getUserMedia({ video: true });
    probe.getTracks().forEach((track) => track.stop());
    devices = await media.enumerateDevices();
  }
  return devices
    .filter((device) => device.kind === "videoinput")
    .map((device) => ({ deviceId: device.deviceId, label: device.label || "名前のない機器" }));
}

export async function openCaptureStream(deviceId: string) {
  const media = navigator.mediaDevices;
  const audio = pairedAudioInput(await media.enumerateDevices(), deviceId);
  return media.getUserMedia({
    video: {
      deviceId: { exact: deviceId },
      width: { ideal: 1920 },
      height: { ideal: 1080 },
      frameRate: { ideal: 30 },
    },
    // 機器の音をそのまま残す。通話向けの補正をかけると音楽や効果音が崩れる。
    audio: audio
      ? {
          deviceId: { exact: audio.deviceId },
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        }
      : false,
  });
}
