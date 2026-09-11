// Lecture script — auto-discovered by the registry.
// PLAN — context 1 · problem 2 · method 3 · invoice 4
// (the three beats, and the shapes that escape them: lecture-scenes skill)
export default [
  {
    id: 'eye',
    title: 'The eye is not a test',
    view: 'sample',
    params: { law: 'gaussian', delta: 0, N: 100, M: 2000 },
    visible: ['law', 'N', 'delta'],
  },
  {
    id: 'gap',
    title: 'The biggest gap has a name',
    view: 'cdf',
    params: { law: 'gaussian', delta: 0.4, N: 100, M: 2000 },
    visible: ['delta', 'N', 'law'],
  },
  {
    id: 'scale',
    title: 'What D does when H₀ is true',
    view: 'null',
    params: { law: 'gaussian', delta: 0, N: 100, M: 2000 },
    visible: ['delta', 'N', 'M', 'law'],
  },
  {
    id: 'power',
    title: 'A small lie needs a large N',
    view: 'null',
    params: { law: 'gaussian', delta: 0.2, N: 50, M: 2000 },
    visible: ['N', 'delta', 'M'],
  },
];
