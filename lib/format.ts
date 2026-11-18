export function formatTime(totalSec: number) {
  const minutes = Math.floor(totalSec / 60);
  const seconds = (totalSec - minutes * 60).toFixed(1).padStart(4, "0");
  return `${minutes}:${seconds}`;
}
