// Structure tensor with Sobel derivatives and a 5x5 box window.
// Integral images keep the tensor calculation linear in the image size.
export class CornerDetector {
  detect(rgba, width, height, { algorithm = 'shi-tomasi', maxPoints = 250, quality = 0.01, minDistance = 10, region = null } = {}) {
    if (rgba.length !== width * height * 4 || width < 9 || height < 9) throw new Error('Invalid image size');
    const n = width * height;
    const stride = width + 1;
    const integralSize = stride * (height + 1);
    if (this.width !== width || this.height !== height) {
      this.width = width; this.height = height;
      this.gray = new Float32Array(n);
      this.xx = new Float64Array(integralSize);
      this.yy = new Float64Array(integralSize);
      this.xy = new Float64Array(integralSize);
      this.scores = new Float32Array(n);
    }
    const { gray, xx, yy, xy, scores } = this;
    for (let i = 0; i < n; i++) gray[i] = (rgba[i*4]*0.299 + rgba[i*4+1]*0.587 + rgba[i*4+2]*0.114) / 255;
    xx.fill(0); yy.fill(0); xy.fill(0); scores.fill(0);
    for (let y = 1; y < height - 1; y++) {
      let sx = 0, sy = 0, sxy = 0;
      for (let x = 1; x < width - 1; x++) {
        const i = y * width + x;
        const gx = (gray[i-width+1] + 2*gray[i+1] + gray[i+width+1] - gray[i-width-1] - 2*gray[i-1] - gray[i+width-1]) / 8;
        const gy = (gray[i+width-1] + 2*gray[i+width] + gray[i+width+1] - gray[i-width-1] - 2*gray[i-width] - gray[i-width+1]) / 8;
        sx += gx*gx; sy += gy*gy; sxy += gx*gy;
        const j = (y+1)*stride + x+1;
        xx[j] = xx[j-stride] + sx; yy[j] = yy[j-stride] + sy; xy[j] = xy[j-stride] + sxy;
      }
    }
    let maxScore = 0;
    const left=Math.max(3,Math.floor(region?.x??3)),top=Math.max(3,Math.floor(region?.y??3));
    const right=Math.min(width-3,Math.ceil(region?region.x+region.width:width-3)),bottom=Math.min(height-3,Math.ceil(region?region.y+region.height:height-3));
    for (let y = top; y < bottom; y++) {
      for (let x = left; x < right; x++) {
        const a = (y-2)*stride+x-2, b = a+5, c = a+5*stride, d = c+5;
        const sxx = xx[d]-xx[b]-xx[c]+xx[a], syy = yy[d]-yy[b]-yy[c]+yy[a], sxy = xy[d]-xy[b]-xy[c]+xy[a];
        const trace = sxx+syy;
        const score = algorithm === 'harris' ? sxx*syy-sxy*sxy-0.04*trace*trace : (trace-Math.hypot(sxx-syy,2*sxy))/2;
        scores[y*width+x] = score;
        maxScore = Math.max(maxScore, score);
      }
    }
    if (maxScore <= 1e-9) return [];
    const threshold = Math.max(1e-9, maxScore * quality);
    const candidates = [];
    for (let y = Math.max(4,top+1); y < Math.min(height-4,bottom-1); y++) {
      for (let x = Math.max(4,left+1); x < Math.min(width-4,right-1); x++) {
        const i = y*width+x, score = scores[i];
        if (score < threshold) continue;
        let peak = true;
        for (let dy=-1; dy<=1 && peak; dy++) for (let dx=-1; dx<=1; dx++) {
          const j = i+dy*width+dx;
          // Deterministic tie breaking prevents plateaus producing duplicate points.
          if (scores[j] > score || (scores[j] === score && j < i)) { peak = false; break; }
        }
        if (peak) candidates.push({ x, y, score });
      }
    }
    candidates.sort((a,b) => b.score-a.score);
    const distance = Math.max(1, minDistance), distance2 = distance*distance;
    const cols = Math.ceil(width/distance), rows = Math.ceil(height/distance);
    const grid = new Map(), points = [];
    for (const point of candidates) {
      const cx = Math.floor(point.x/distance), cy = Math.floor(point.y/distance);
      let nearby = false;
      for (let y=Math.max(0,cy-1); y<=Math.min(rows-1,cy+1) && !nearby; y++) {
        for (let x=Math.max(0,cx-1); x<=Math.min(cols-1,cx+1); x++) {
          if ((grid.get(y*cols+x) || []).some(p => (p.x-point.x)**2+(p.y-point.y)**2 < distance2)) { nearby = true; break; }
        }
      }
      if (nearby) continue;
      points.push(point);
      const key = cy*cols+cx;
      if (!grid.has(key)) grid.set(key, []);
      grid.get(key).push(point);
      if (points.length >= maxPoints) break;
    }
    return points;
  }
}
