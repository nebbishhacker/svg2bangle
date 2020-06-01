(() => {
  'use strict';

  function replaceUseElements(svg, element = svg) {
    for (const use of Array.from(element.getElementsByTagName("use"))) {
      const target = svg.querySelector(use.href.baseVal);
      if (!target) continue;

      const g = document.createElementNS("http://www.w3.org/2000/svg", "g");

      Array.from(use.attributes)
        .filter(a => !["x", "y", "width", "height", "href", "xlink:href"].includes(a.name))
        .forEach(a => g.setAttribute(a.name, a.value));

      const t = svg.createSVGTransform();
      t.setTranslate(use.x.baseVal.value, use.y.baseVal.value);
      g.transform.baseVal.appendItem(t);

      let child;
      if (target.tagName == "symbol" || target.tagName == "svg") {
        child = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        Array.from(target.attributes).forEach(a => child.setAttribute(a.name, a.value));
        child.innerHTML = target.innerHTML;
        if (use.getAttribute("width")) child.setAttribute("width", use.getAttribute("width"));
        if (use.getAttribute("height")) child.setAttribute("height", use.getAttribute("height"));
        if (target.tagName == "symbol") {
          if (!child.getAttribute("width")) child.setAttribute("width", "100%");
          if (!child.getAttribute("height")) child.setAttribute("height", "100%");
        }
      }
      else child = target.cloneNode(true);

      g.appendChild(child);
      use.replaceWith(g);

      replaceUseElements(svg, g);
    }
  }

  function bezier(points, t) {
    const n = 1-t;
    return {
      x: points[0].x*n*n*n + points[1].x*3*n*n*t + points[2].x*3*n*t*t + points[3].x*t*t*t,
      y: points[0].y*n*n*n + points[1].y*3*n*n*t + points[2].y*3*n*t*t + points[3].y*t*t*t
    };
  }

  function sampleBezier(points, samples) {
    const result = [];
    for (let i = 1; i <= samples; ++i) {
      result.push(bezier(points, i / samples));
    }
    return result;
  }

  // Convert  "rgb(r, b, g)"" into "#rrggbb"
  function rgb2hex(color) {
    return "#" +
      color.match(/\d+/g)
      .slice(0, 3)
      .map(x => parseInt(x).toString(16).padStart(2, "0"))
      .join("");
  }

  function isVisible(node) {
    if (!node || !node.style) return true;
    if (node.tagName == "symbol" || node.tagName == "defs" || node.style.display == "none") return false;
    return isVisible(node.parentNode);
  }

  function getTransform(svg, node) {
    let t = node.getCTM();
    let p = node.parentNode;
    while (p != svg) {
      if (p.tagName == "svg") t = p.getCTM().multiply(t);
      p = p.parentNode;
    }
    return t;
  }

  function svgShape2Polys(svg, svgShape, sampleCount, tolerance, maxPoints) {
    if (!isVisible(svgShape)) return [];

    const style = getComputedStyle(svgShape);
    let filled = style.fill && style.fill != "none";
    let stroked = style.stroke && style.stroke != "none";
    if (!filled && !stroked) return [];

    const transform = getTransform(svg, svgShape);
    const segments = svgShape.getPathData({normalize: true});

    let subpaths = [];
    let subpath = [];
    for (const seg of segments) {
      const values = [];
      for (let i = 0; i < seg.values.length; i += 2) {
        const p = svg.createSVGPoint();
        p.x = seg.values[i];
        p.y = seg.values[i+1];
        values.push(p.matrixTransform(transform));
      }

    	switch(seg.type) {
    		case "M":
          if (subpath.length) {
            subpaths.push(subpath);
            subpath = [];
          }
          subpath.push(values[0]);
          break;
    		case "L":
          subpath.push(values[0]);
          break;
    		case "C":
          let points = sampleBezier([subpath[subpath.length-1], ...values], sampleCount);
          points = simplify(points, tolerance);
          subpath.push(...points);
          break;
    		case "Z":
          subpath.push(subpath[0]);
          subpaths.push(subpath);
          subpath = [];
          break;
    	}
    }

    if (subpath.length) {
      subpaths.push(subpath);
    }

    if (!stroked) {
      for (subpath of subpaths) {
        if (subpath[0].x == subpath[subpath.length-1].x && subpath[0].y == subpath[subpath.length-1].y) {
          subpath.pop();
        }
      }
    }

    subpaths = subpaths.map(subpath => simplify(subpath, tolerance, true));

    const polys = subpaths.map(points => {
      let poly = {points: points};
      if (filled) poly.fill = rgb2hex(style.fill);
      if (stroked) poly.stroke = rgb2hex(style.stroke);
      return poly;
    });

    return polys;
  }

  // Convert an ArrayBufferView into an expression that will produce the same buffer on an Espruino
  function encodeBufferView(view) {
    let b64 = btoa(String.fromCharCode.apply(null, new Uint8Array(view.buffer)));
    return `new ${view.constructor.name}(E.toArrayBuffer(atob("${b64}")))`;
  }

  // Convert an array into an expression that will produce a Float32Array
  function encodeAsFloatArray(arr) {
    return encodeBufferView(new Float32Array(arr));
  }

  // Convert an array into an expression that will produce the smallest possible fixed integer array
  function encodeAsIntArray(arr) {
    arr = arr.map(v => Math.round(v))
    const min = Math.min(...arr);
    const max = Math.max(...arr);
    if (min >= 0 && max <= 255) return encodeBufferView(new Uint8Array(arr));
    if (min >= -128 && max <= 127) return encodeBufferView(new Int8Array(arr));
    if (min >= 0 && max <= 65535) return encodeBufferView(new Uint16Array(arr));
    if (min >= -32768 && max <= 32767) return encodeBufferView(new Int16Array(arr));
    if (min >= 0 && max <= 4294967295) return encodeBufferView(new Uint32Array(arr));
    if (min >= -2147483648 && max <= 2147483647) encodeBufferView(new Int32Array(arr));
  }

  // Convert an SVG into something easier to parse on the Bangle.js
  function svg2bangle(svg, options) {
    const tolerance = options.tolerance || 0;
    const maxPoints = options.maxPoints || 63;
    const scale = options.scale || 1;
    const sampleCount = options.sampleCount || 1000;
    const originX = options.originX || 0;
    const originY = options.originY || 0;
    const numberFormat = options.numberFormat || "int";
    if ((!svg.getAttribute("width") || svg.getAttribute("width").includes("%")) &&
      (!svg.getAttribute("height") || svg.getAttribute("height").includes("%"))) {
      svg.setAttribute("width", svg.viewBox.baseVal.width + "px");
      svg.setAttribute("height", svg.viewBox.baseVal.height + "px");
    }
    svg.width.baseVal.value *= scale;
    svg.height.baseVal.value *= scale;

    replaceUseElements(svg);

    let polys = []
    for (const svgShape of svg.querySelectorAll('rect,circle,ellipse,line,polyline,polygon,path')) {
      polys.push(...svgShape2Polys(svg, svgShape, sampleCount, tolerance, maxPoints));
    }
    polys = polys.map(poly => {
      poly.points = poly.points.map(p => ({x: p.x - originX * scale, y: p.y - originY * scale}));
      return poly;
    });

    return `var polyImg = [\n${
      polys.map(poly => {
        let points = poly.points.flatMap(p => [p.x, p.y]);
        let fields = [];
        if (poly.fill) fields.push(`fill: "${poly.fill}"`);
        if (poly.stroke) fields.push(`stroke: "${poly.stroke}"`);
        let encodedPoints;
        if (numberFormat == "float") encodedPoints = encodeAsFloatArray(points);
        else if (numberFormat == "int") encodedPoints = encodeAsIntArray(points);
        else encodedPoints = JSON.stringify(points.map(n => Math.round(n * 1000) / 1000));
        fields.push("points: " + encodedPoints);
        return `  {${fields.join(', ')}}`;
      }).join(",\n")
    }\n];`;
  }

  window.svg2bangle = svg2bangle;

})();