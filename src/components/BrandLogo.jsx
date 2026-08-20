import markUrl from '../assets/brand/mark.svg';
import wordmarkUrl from '../assets/brand/wordmark.svg';

export function BrandWordmark({ className = 'h-9' }) {
  return (
    <img
      src={wordmarkUrl}
      alt="Apollo"
      draggable="false"
      className={`block w-auto max-w-full flex-shrink-0 ${className}`}
    />
  );
}

export function BrandMark({ className = 'h-12 w-12', alt = 'Apollo' }) {
  return (
    <img
      src={markUrl}
      alt={alt}
      draggable="false"
      className={`block ${className}`}
    />
  );
}
