import { PuzzleView } from "@magic-spells/puzzle";
class HandlerFormsTs extends PuzzleView {
  created() {
    this.setState("count", 0);
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
      this.setState("count", this.getData().count + 1);
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
export {
  HandlerFormsTs as default
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiSGFuZGxlckZvcm1zVHMucHpsIl0sCiAgIm1hcHBpbmdzIjogIkFBUUEsU0FBUyxrQkFBa0I7QUFRM0IsTUFBTyx1QkFBcUMsV0FBVztBQUFBLEVBQ3JELFVBQWdCO0FBQ2QsU0FBSyxTQUFTLFNBQVMsQ0FBQztBQUFBLEVBQzFCO0FBQUEsRUFFQSxTQUFTO0FBQUEsSUFDUCxLQUFLLE9BQXlCO0FBQzVCLE1BQUMsS0FBOEIsU0FBUyxNQUFNLFNBQVM7QUFBQSxJQUN6RDtBQUFBLElBQ0EsTUFBTSxPQUFzQjtBQUMxQixZQUFNO0FBQ04sTUFBQyxLQUE4QixTQUFTO0FBQUEsSUFDMUM7QUFBQSxJQUNBLFFBQWdCO0FBQ2QsYUFBTztBQUFBLElBQ1Q7QUFBQSxJQUNBLE1BQU0sTUFBWTtBQUNoQixXQUFLLFNBQVMsU0FBUyxLQUFLLFFBQW9CLEVBQUUsUUFBUSxDQUFDO0FBQUEsSUFDN0Q7QUFBQSxFQUNGO0FBQ0Y7QUFFQSxTQUFTLFVBQVUsZ0JBQWdCLFdBQVc7QUFFOUMsZUFBZSxVQUFVLFNBQVMsV0FBWTtBQUM1QyxRQUFNLE1BQU0sS0FBSyxRQUFRO0FBRXpCLFNBQU8sSUFBSSxTQUFTLGVBQWUsQ0FBQyxHQUFHO0FBQUEsSUFDckMsSUFBSSxTQUFTLFVBQVU7QUFBQSxNQUNyQixPQUFPO0FBQUEsTUFDUCxXQUFZLEtBQUssUUFBUSxDQUFDLEdBQUcsQ0FBQyxNQUFNLENBQUMsVUFBVSxLQUFLLE9BQU8sS0FBSyxLQUFLO0FBQUEsSUFDdkUsR0FBRztBQUFBLE1BQ0QsSUFBSSxTQUFTLFFBQVEsRUFBRSxPQUFPLE9BQU8sQ0FBQztBQUFBLElBQ3hDLENBQUM7QUFBQSxJQUNELElBQUksU0FBUyxVQUFVO0FBQUEsTUFDckIsT0FBTztBQUFBLE1BQ1AsV0FBWSxLQUFLLFFBQVEsQ0FBQyxHQUFHLENBQUMsTUFBTSxDQUFDLFVBQVUsS0FBSyxPQUFPLEtBQUssS0FBSztBQUFBLElBQ3ZFLEdBQUc7QUFBQSxNQUNELElBQUksU0FBUyxRQUFRLEVBQUUsT0FBTyxPQUFPLENBQUM7QUFBQSxJQUN4QyxDQUFDO0FBQUEsSUFDRCxJQUFJLFNBQVMsVUFBVTtBQUFBLE1BQ3JCLE9BQU87QUFBQSxNQUNQLFdBQVksS0FBSyxRQUFRLENBQUMsR0FBRyxDQUFDLE1BQU0sQ0FBQyxVQUFVLEtBQUssT0FBTyxNQUFNLEtBQUs7QUFBQSxJQUN4RSxHQUFHO0FBQUEsTUFDRCxJQUFJLFNBQVMsUUFBUSxFQUFFLE9BQU8sUUFBUSxDQUFDO0FBQUEsSUFDekMsQ0FBQztBQUFBLElBQ0QsSUFBSSxTQUFTLFVBQVU7QUFBQSxNQUNyQixPQUFPO0FBQUEsTUFDUCxXQUFZLEtBQUssUUFBUSxDQUFDLEdBQUcsQ0FBQyxNQUFNLENBQUMsVUFBVSxLQUFLLE9BQU8sS0FBSyxLQUFLO0FBQUEsSUFDdkUsR0FBRztBQUFBLE1BQ0QsSUFBSSxTQUFTLFFBQVEsRUFBRSxPQUFPLElBQUksSUFBSSxPQUFPLE9BQU8sbUJBQW1CLGVBQWUsaUJBQWlCLFVBQVUsQ0FBQyxFQUFFLENBQUM7QUFBQSxJQUN2SCxDQUFDO0FBQUEsRUFDSCxDQUFDO0FBQ0g7IiwKICAibmFtZXMiOiBbXQp9Cg==
