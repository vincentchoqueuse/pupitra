// Lecture script — auto-discovered by the registry.
export default [
  {
    id: 'blur',
    title: 'Smoothing erases the center first',
    params: { kernel: 'gaussian', N: 5 },
    visible: ['kernel', 'N'],
  },
  {
    id: 'edges',
    title: 'The same operation finds boundaries instead',
    params: { kernel: 'sobel' },
    visible: ['kernel', 'N'],
  },
];
