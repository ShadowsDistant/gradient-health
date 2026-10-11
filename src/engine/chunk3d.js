/* The 3D chunk (dist/lazy/figure3d.js, GH.lazy('figure3d')): the exercise figure and the badges'
 * medals, so three.js ships once. Each sets its own GH entry: GH.figure3d, GH.medal3d. Then the
 * badges' side of the medals (src/ui/badges3d.js: drawing their stills and keeping them, the live one
 * on a stage), which needs GH.medal3d.
 */
import './figure3d.js';
import './medal3d.js';
import '../ui/badges3d.js';
