import { serialSupport } from './serialSupport';

test('insecure HTTP, unavailable API and denied policy have distinct actionable guidance', () => {
  const serial = { requestPort: jest.fn() };
  expect(serialSupport({ secureContext: false, serial }).reason).toContain('insecure page');
  expect(serialSupport({ secureContext: true }).reason).toContain('does not provide Web Serial');
  const policy = { allowsFeature: jest.fn(() => false) };
  expect(serialSupport({ secureContext: true, serial, policy })).toMatchObject({ supported: false });
  expect(policy.allowsFeature).toHaveBeenCalledWith('serial');
  expect(serialSupport({ secureContext: true, serial })).toEqual({ supported: true, reason: null });
  expect(serial.requestPort).not.toHaveBeenCalled();
});
