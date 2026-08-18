// Order 13, at the end of the catalogue rather than inserted after
// `filtering` (which would read as the more natural place — the 2D
// generalization of the 1D signal chain). Placement is an open question
// raised with the maintainer (issue #94, unanswered as of writing); taking
// the free slot at the end costs nothing to revisit and touches no other
// subject's `order`, whereas inserting at 9 would require renumbering
// control/comm/numerics/ml. Revisit once Vincent has weighed in.
export default { title: 'Image processing', order: 13 };
