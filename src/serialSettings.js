export const DEFAULT_BAUD_RATE = 115200;
export const BAUD_RATES = [9600, 19200, 38400, 57600, 115200, 230400];
export const BAUD_STORAGE_KEY = 'fermentor.serialBaudRate';
export const isBaudRate = (value) => BAUD_RATES.includes(value);

export function savedBaudRate() {
  try {
    const value = Number(window.localStorage.getItem(BAUD_STORAGE_KEY));
    if (isBaudRate(value)) return value;
  } catch { /* Storage is optional; USB reading must still work. */ }
  return DEFAULT_BAUD_RATE;
}
