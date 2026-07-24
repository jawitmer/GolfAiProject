import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.patches import Polygon
from matplotlib.backends.backend_pdf import PdfPages
import numpy as np, io, base64, os
from PIL import Image

ns = {}
exec(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'all_holes_data_v3_64.py')).read(), ns)
HOLES = ns['HOLES']

def score_to_color(v):
    if v >= 4.5: return '#1B7A2B'
    elif v >= 4.0: return '#4CAF50'
    elif v >= 3.5: return '#8BC34A'
    elif v >= 3.0: return '#CDDC39'
    elif v >= 2.5: return '#FFC107'
    elif v >= 2.0: return '#FF9800'
    elif v >= 1.5: return '#FF5722'
    else: return '#B71C1C'

def draw_hole(h, axes):
    d = HOLES[h]
    b64 = d['photo_b64']
    if b64.startswith('data:'):            # defensive: master convention is bare base64
        b64 = b64.split(',', 1)[1]
    img = np.array(Image.open(io.BytesIO(base64.b64decode(b64))))
    xl, yl = d['xlim'], d['ylim']
    for pin_idx in range(5):
        ax = axes[pin_idx]
        # extent in DATA coordinates (not raw pixel dims)
        ax.imshow(img, alpha=0.30, extent=[xl[0], xl[1], yl[0], 0])
        for sk in d['sector_order']:
            poly = np.asarray(d['sectors'][sk])
            score = d['scores'][sk][pin_idx]
            ax.add_patch(Polygon(poly, closed=True, facecolor=score_to_color(score),
                                 edgecolor='white', linewidth=1.0, alpha=0.75))
            cx, cy = poly[:, 0].mean(), poly[:, 1].mean()
            ax.text(cx, cy, f'{score:g}', ha='center', va='center', fontsize=5.5,
                    fontweight='bold', color='black',
                    bbox=dict(boxstyle='round,pad=0.08', facecolor='white',
                              alpha=0.7, edgecolor='none'))
        gp = d.get('green_polygon')
        if gp is not None:
            ax.add_patch(Polygon(np.asarray(gp), closed=True, fill=False,
                                 edgecolor='#111111', linewidth=1.0, linestyle='-'))
        px, py = d['pin_pos'][pin_idx + 1]
        ax.plot([px, px], [py, py - 15], color='red', linewidth=1.5, zorder=5)
        ax.plot(px, py, 'o', color='black', markersize=5, zorder=6)
        ax.set_xlim(xl); ax.set_ylim(yl); ax.set_aspect('equal'); ax.axis('off')
        ax.set_title(f"Pin {pin_idx+1} ({d['pin_labels'][pin_idx+1]})",
                     fontsize=8, fontweight='bold')

pdf_path = '/mnt/user-data/outputs/AQ_Sector_Maps_v3.64_all18.pdf'
with PdfPages(pdf_path) as pdf:
    fig = plt.figure(figsize=(11, 8.5))
    fig.text(0.5, 0.62, 'Oberlin Golf Club', ha='center', fontsize=28, fontweight='bold')
    fig.text(0.5, 0.53, 'AQ Sector Maps — data v3.64', ha='center', fontsize=17, color='#555')
    fig.text(0.5, 0.46, '18 Holes x 5 Pin Positions', ha='center', fontsize=13, color='#777')
    for i, s in enumerate([1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5]):
        x = 0.28 + i * 0.055
        fig.patches.append(plt.Rectangle((x, 0.28), 0.045, 0.04, facecolor=score_to_color(s),
                           edgecolor='grey', linewidth=0.5, transform=fig.transFigure))
        fig.text(x + 0.022, 0.26, f'{s:g}', ha='center', va='top', fontsize=8)
    fig.text(0.5, 0.34, 'AQ Score', ha='center', fontsize=10, fontweight='bold')
    pdf.savefig(fig); plt.close(fig)

    for h in range(1, 19):
        fig, axes = plt.subplots(1, 5, figsize=(11, 3.4))
        fig.suptitle(f'Hole {h}   ({len(HOLES[h]["sector_order"])} sectors)',
                     fontsize=15, fontweight='bold', y=1.00)
        draw_hole(h, axes)
        plt.tight_layout(rect=[0, 0, 1, 0.94])
        pdf.savefig(fig, bbox_inches='tight'); plt.close(fig)
        print(f'hole {h} done')
print('PDF:', pdf_path)
