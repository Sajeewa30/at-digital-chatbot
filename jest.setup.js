import "@testing-library/jest-dom";

if (!global.crypto) {
  global.crypto = {};
}

let uuidCounter = 0;
const randomUUIDMock = jest.fn(() => `mock-uuid-${uuidCounter++}`);

Object.defineProperty(global, "crypto", {
  value: { ...global.crypto, randomUUID: randomUUIDMock },
});

beforeEach(() => {
  uuidCounter = 0;
  randomUUIDMock.mockClear();
});

if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = jest.fn();
}
