const fs = require("fs");
const path = require("path");

const SECTIONS = [
  {
    id: "cws-t01-horizontal-scroll",
    name: "Horizontal Scroll Testimonials",
    description:
      "Draggable horizontal scrolling testimonial cards with avatars and star ratings.",
    category: "Testimonials",
    file: "t01-horizontal-scroll.liquid",
  },
  {
    id: "cws-t02-infinite-marquee",
    name: "Infinite Marquee",
    description: "Auto-scrolling testimonial marquee strip.",
    category: "Testimonials",
    file: "t02-infinite-marquee.liquid",
  },
  {
    id: "cws-t03-video-testimonials",
    name: "Video Testimonials",
    description: "Showcase video testimonials in a clean grid.",
    category: "Testimonials",
    file: "t03-video-testimonials.liquid",
  },
  {
    id: "cws-t04-chat-testimonials",
    name: "Chat Testimonials",
    description: "Display testimonials as a chat conversation.",
    category: "Testimonials",
    file: "t04-chat-testimonials.liquid",
  },
  {
    id: "cws-t05-center-carousel",
    name: "Center Carousel",
    description: "Centered testimonial carousel with navigation.",
    category: "Testimonials",
    file: "t05-center-carousel.liquid",
  },
  {
    id: "cws-t06-split-stats",
    name: "Split Stats",
    description: "Split layout with testimonial and key statistics.",
    category: "Testimonials",
    file: "t06-split-stats.liquid",
  },
  {
    id: "cws-t07-before-after",
    name: "Before & After Slider",
    description: "Interactive image comparison slider.",
    category: "Media",
    file: "t07-before-after.liquid",
  },
  {
    id: "cws-t08-timeline",
    name: "Timeline",
    description: "Display your story or process as a timeline.",
    category: "Content",
    file: "t08-timeline.liquid",
  },
  {
    id: "cws-t09-floating-cards",
    name: "Floating Cards",
    description: "Animated floating testimonial cards layout.",
    category: "Testimonials",
    file: "t09-floating-cards.liquid",
  },
  {
    id: "cws-t10-masonry-grid",
    name: "Masonry Grid",
    description: "Pinterest-style masonry grid of testimonials.",
    category: "Testimonials",
    file: "t10-masonry-grid.liquid",
  },
];

function getSectionLiquid(filename) {
  const filePath = path.join(__dirname, "liquid", filename);
  return fs.readFileSync(filePath, "utf8");
}

module.exports = { SECTIONS, getSectionLiquid };
