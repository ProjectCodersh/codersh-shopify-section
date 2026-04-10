export const SECTIONS = [
  {
    id: "cws-faq",
    name: "FAQ Section",
    description:
      "Clean accordion FAQ section with customizable questions and answers.",
    category: "Content",
    gradient: "135deg, #6366f1 0%, #8b5cf6 100%",
    iconPath:
      "M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z",
  },
  {
    id: "cws-testimonials",
    name: "Testimonials",
    description: "Display customer reviews in a beautiful grid layout.",
    category: "Social Proof",
    gradient: "135deg, #f59e0b 0%, #f97316 100%",
    iconPath:
      "M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z",
  },
  {
    id: "cws-before-after",
    name: "Before & After Slider",
    description: "Interactive before and after image comparison slider.",
    category: "Media",
    gradient: "135deg, #06b6d4 0%, #3b82f6 100%",
    iconPath:
      "M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4",
  },
];

export const CATEGORIES = ["All", ...new Set(SECTIONS.map((s) => s.category))];
