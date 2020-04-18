# SVG2Bangle

An online tool for converting SVG files into polygons that can be rendered on a [Bangle.js](https://banglejs.com/).

Supported:
 - All basic shapes (rect, circle, polyline, path, etc)
 - Fill colors
 - Stroke colors
 - `<use>` elements

Not supported:
 - Paths with holes
 - Stroke widths other than 1 pixel
 - Viewport clipping
 - Anything even remotely fancy

## Conversion
Use the online tool [here](https://nebbishhacker.github.io/svg2bangle/).
    
## Rendering
The following function can be used on the smartwatch to render the output of the converter:

```
// Draw an image composed of coloured polygons
//
// polys - A list of objects representing polygons, of the form
//   [
//     {
//       optional fill : "#012345",
//       optional stroke : "#012345",
//       points : [x0,y0,x1,y1,x2,y2,...],
//     },
//     ...
//   ]
// x - The X offset to draw the image
// y - The Y offset to draw the image
// options - an object of the form
//   {
//     rotate : 0, // amount to rotate image in radians
//     scale : 1,  // factor by which scale image
//     graphics : Graphics // the graphics object to use
//   }
function drawPolyImage(polys, x, y, options) {
  const o = options || {};
  const g = o.graphics || global.g;
  const a = o.rotate || 0;
  const s = o.scale != null ? o.scale : 1;
  const ca = Math.cos(a), sa = Math.sin(a);
  for (let p of polys) {
    const pts = [];
    for (var i = 0; i &lt; p.points.length; i += 2) {
      pts.push(p.points[i]*ca*s - p.points[i+1]*sa*s + x);
      pts.push(p.points[i+1]*ca*s + p.points[i]*sa*s + y);
    }
    if (p.fill) g.setColor(p.fill).fillPoly(pts);
    if (p.stroke) g.setColor(p.stroke).drawPoly(pts);
  }
}
```