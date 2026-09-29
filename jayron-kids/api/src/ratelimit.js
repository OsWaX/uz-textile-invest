'use strict';
/**
 * Счётчик попыток в памяти процесса: не более limit событий за windowMs на ключ.
 * Защищает от перебора пароля администратора и от массовой рассылки SMS.
 */
class RateLimiter {
  constructor(limit, windowMs) {
    this.limit = limit;
    this.windowMs = windowMs;
    this.hits = new Map();
  }

  /** Регистрирует событие. Возвращает false, если лимит уже исчерпан. */
  take(key) {
    const now = Date.now();
    const fresh = (this.hits.get(key) || []).filter((t) => now - t < this.windowMs);
    if (fresh.length >= this.limit) {
      this.hits.set(key, fresh);
      return false;
    }
    fresh.push(now);
    this.hits.set(key, fresh);
    if (this.hits.size > 10_000) this.prune(now);
    return true;
  }

  reset(key) {
    this.hits.delete(key);
  }

  prune(now = Date.now()) {
    for (const [key, times] of this.hits) {
      if (!times.some((t) => now - t < this.windowMs)) this.hits.delete(key);
    }
  }
}

module.exports = { RateLimiter };
