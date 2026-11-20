// puzzle app configuration (D12/D26). declaring the tailwind pipeline makes
// `puzzle build` / `puzzle dev` run the tailwind cli and fold its output into
// dist/styles.css ahead of the collected <style> blocks.
export default {
  styles: {
    use: ['tailwindcss'],
  },
};
