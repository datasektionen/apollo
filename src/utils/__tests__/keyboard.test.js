import { describe, expect, it } from 'vitest';
import { isTextEntryTarget } from '../keyboard';

function fakeEvent(target) {
  return { target };
}

describe('isTextEntryTarget', () => {
  it('treats text fields and textareas as text entry', () => {
    expect(isTextEntryTarget(fakeEvent({ tagName: 'INPUT', type: 'text' }))).toBe(true);
    expect(isTextEntryTarget(fakeEvent({ tagName: 'INPUT', type: 'search' }))).toBe(true);
    expect(isTextEntryTarget(fakeEvent({ tagName: 'TEXTAREA' }))).toBe(true);
    expect(isTextEntryTarget(fakeEvent({ tagName: 'DIV', isContentEditable: true }))).toBe(true);
  });

  it('keeps native Space on checkboxes, radios, file inputs, and selects', () => {
    expect(isTextEntryTarget(fakeEvent({ tagName: 'INPUT', type: 'checkbox' }))).toBe(true);
    expect(isTextEntryTarget(fakeEvent({ tagName: 'INPUT', type: 'radio' }))).toBe(true);
    expect(isTextEntryTarget(fakeEvent({ tagName: 'INPUT', type: 'file' }))).toBe(true);
    expect(isTextEntryTarget(fakeEvent({ tagName: 'SELECT' }))).toBe(true);
  });

  it('lets Space reach transport for buttons and range sliders', () => {
    expect(isTextEntryTarget(fakeEvent({ tagName: 'BUTTON' }))).toBe(false);
    expect(isTextEntryTarget(fakeEvent({ tagName: 'INPUT', type: 'button' }))).toBe(false);
    expect(isTextEntryTarget(fakeEvent({ tagName: 'INPUT', type: 'range' }))).toBe(false);
    expect(isTextEntryTarget(fakeEvent({ tagName: 'DIV' }))).toBe(false);
    expect(isTextEntryTarget(fakeEvent({ tagName: 'BODY' }))).toBe(false);
  });
});
