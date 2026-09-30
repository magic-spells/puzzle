import { PuzzleView } from "@magic-spells/puzzle";
class HandlerFormsTs extends PuzzleView {
  created() {
    this.setData("count", 0);
  }
  events = {
    play(event) {
      this.played = event.type === "click";
    },
    async load() {
      await null;
      this.loaded = true;
    },
    reset() {
      return "this is fine";
    },
    bump: () => {
      this.setData("count", this.getData().count + 1);
    }
  };
}
import { ViewNode, displayValue as __s } from "@magic-spells/puzzle";
HandlerFormsTs.prototype.render = function() {
  const __d = this.getData();
  return new ViewNode("puzzle-view", {}, [
    new ViewNode("button", {
      class: "play",
      "@click": (this.__h ??= {})[0] ??= (event) => this.events.play(event)
    }, [
      new ViewNode("text", { value: "play" })
    ]),
    new ViewNode("button", {
      class: "load",
      "@click": (this.__h ??= {})[1] ??= (event) => this.events.load(event)
    }, [
      new ViewNode("text", { value: "load" })
    ]),
    new ViewNode("button", {
      class: "reset",
      "@click": (this.__h ??= {})[2] ??= (event) => this.events.reset(event)
    }, [
      new ViewNode("text", { value: "reset" })
    ]),
    new ViewNode("button", {
      class: "bump",
      "@click": (this.__h ??= {})[3] ??= (event) => this.events.bump(event)
    }, [
      new ViewNode("text", { value: __s(__d.count, typeof __PUZZLE_DEV__ === "undefined" || __PUZZLE_DEV__ ? "count" : 0) })
    ])
  ]);
};
HandlerFormsTs.__pzlModule = "HandlerFormsTs.pzl";
export {
  HandlerFormsTs as default
};
