// a class with a setData of its own: not a view, so the codemod leaves it be
export class Fake {
  setData(key, value) {
    this[key] = value;
  }
  run() {
    this.setData('a', 1);
  }
}
