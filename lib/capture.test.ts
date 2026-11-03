import { describe, expect, it } from "vitest";
import { captureErrorMessage, pairedAudioInput, preferCaptureDevice } from "./capture";

describe("preferCaptureDevice", () => {
  it("内蔵カメラより外付けのキャプチャ機器を選ぶ", () => {
    const devices = [
      { deviceId: "a", label: "FaceTime HD カメラ" },
      { deviceId: "b", label: "USB3.0 HD Video Capture" },
    ];
    expect(preferCaptureDevice(devices)?.deviceId).toBe("b");
  });

  it("内蔵カメラしかなければそれを選ぶ", () => {
    expect(preferCaptureDevice([{ deviceId: "a", label: "Integrated Camera" }])?.deviceId).toBe("a");
  });

  it("機器が無ければ何も選ばない", () => {
    expect(preferCaptureDevice([])).toBeUndefined();
  });
});

describe("pairedAudioInput", () => {
  const devices = [
    { kind: "videoinput", deviceId: "cam", groupId: "g1" },
    { kind: "audioinput", deviceId: "mic", groupId: "g0" },
    { kind: "videoinput", deviceId: "capture", groupId: "g2" },
    { kind: "audioinput", deviceId: "capture-audio", groupId: "g2" },
  ] as const;

  it("同じ機器の音声入力を返す", () => {
    expect(pairedAudioInput([...devices], "capture")?.deviceId).toBe("capture-audio");
  });

  it("同じ機器に音声が無ければ、別のマイクは使わない", () => {
    expect(pairedAudioInput([...devices], "cam")).toBeUndefined();
  });

  it("知らない映像入力には何も返さない", () => {
    expect(pairedAudioInput([...devices], "unknown")).toBeUndefined();
  });
});

describe("captureErrorMessage", () => {
  it("他のアプリが使用中のときは、その旨を伝える", () => {
    expect(captureErrorMessage(new DOMException("", "NotReadableError"))).toMatch("他のアプリ");
  });

  it("想定外のエラーはそのメッセージを使う", () => {
    expect(captureErrorMessage(new Error("失敗"))).toBe("失敗");
  });
});
