function perKey() {
  const tails = new Map();
  return (key, fn) => {
    const current = (tails.get(key) ?? Promise.resolve()).then(fn);
    const tail = current.catch(() => {});
    tails.set(key, tail);
    void tail.then(() => {
      if (tails.get(key) === tail) tails.delete(key);
    });
    return current;
  };
}

module.exports = {perKey};
