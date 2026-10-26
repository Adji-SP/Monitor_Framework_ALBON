import { DEFAULT_BAUD_RATE, BAUD_STORAGE_KEY, savedBaudRate } from './serialSettings';

afterEach(() => { jest.restoreAllMocks(); localStorage.clear(); });

test('baud preference restores only allowed numeric rates', () => {
  expect(savedBaudRate()).toBe(DEFAULT_BAUD_RATE);
  localStorage.setItem(BAUD_STORAGE_KEY, '57600'); expect(savedBaudRate()).toBe(57600);
  for (const value of ['invalid', '', 'NaN', '0', '-9600', '12345']) {
    localStorage.setItem(BAUD_STORAGE_KEY, value); expect(savedBaudRate()).toBe(DEFAULT_BAUD_RATE);
  }
});

test('blocked storage uses the default instead of breaking USB setup', () => {
  jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
  expect(savedBaudRate()).toBe(DEFAULT_BAUD_RATE);
});
