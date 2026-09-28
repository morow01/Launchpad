// Page layouts ("templates"). Each id matches a body[data-layout="..."] block in css/layouts.css.
// `mini` draws the little preview in the settings panel: [left%, top%, width%, height%, isAccent].

export const LAYOUTS = {
  classic: {
    name: "Classic",
    description: "Everything centred",
    mini: [[36, 10, 28, 16], [41, 30, 18, 5], [24, 44, 52, 9, 1], [20, 62, 60, 16]],
  },
  focus: {
    name: "Focus",
    description: "Big clock, icon shortcuts",
    mini: [[22, 18, 56, 28], [36, 54, 28, 7, 1], [38, 70, 24, 8]],
  },
  split: {
    name: "Split",
    description: "Clock left, links right",
    mini: [[8, 30, 32, 20], [8, 55, 22, 5], [50, 22, 42, 9, 1], [50, 40, 42, 32]],
  },
  topbar: {
    name: "Top bar",
    description: "Small clock, large search",
    mini: [[4, 8, 14, 9], [21, 10, 16, 5], [18, 38, 64, 11, 1], [24, 60, 52, 20]],
  },
};
