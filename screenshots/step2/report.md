| viewport | check | result | detail |
|---|---|---|---|
| portrait 412x915 | edges: root: no stray edges | PASS | 1355 edges, 0/85371 stray px (0.00 %) |
| portrait 412x915 | edges: root: no missing edges | PASS | 46 near edges checked |
| portrait 412x915 | edges: a folder: no stray edges | PASS | 832 edges, 0/63567 stray px (0.00 %) |
| portrait 412x915 | edges: a folder: no missing edges | PASS | 48 near edges checked |
| portrait 412x915 | edges: file opened its galaxy (setup) | PASS | 15 symbol nodes |
| portrait 412x915 | edges: file open (symbols): no stray edges | PASS | 630 edges, 0/56838 stray px (0.00 %) |
| portrait 412x915 | edges: file open (symbols): no missing edges | PASS | 48 near edges checked |
| portrait 412x915 | edges: a symbol focused: no stray edges | PASS | 284 edges, 0/21037 stray px (0.00 %) |
| portrait 412x915 | edges: a symbol focused: no missing edges | PASS | 28 near edges checked |
| portrait 412x915 | edges: mid-glide (was animating: true) | PASS | 0.00 % stray, 0 missing |
| portrait 412x915 | edges: after the glide, two files open: no stray edges | PASS | 382 edges, 0/41161 stray px (0.00 %) |
| portrait 412x915 | edges: after the glide, two files open: no missing edges | PASS | 38 near edges checked |
| portrait 412x915 | edges: files closed again after leaving (no leftover galaxies) | PASS | {"open":0,"dyn":0} |
| portrait 412x915 | edges: after 20 files opened and closed, back at root: no stray edges | PASS | 966 edges, 0/74470 stray px (0.00 %) |
| portrait 412x915 | edges: after 20 files opened and closed, back at root: no missing edges | PASS | 46 near edges checked |
| portrait 412x915 | arcs: found sample foci (file, class, method, function) | PASS | {"file":[0,-2],"func":[0,0],"cls":[2,0],"method":[2,2]} |
| portrait 412x915 | arcs: focus = file | PASS | 7 arcs for 25/25 links, 2 merged |
| portrait 412x915 | arcs: focus = func | PASS | 3 arcs for 21/21 links, 2 merged |
| portrait 412x915 | arcs: focus = cls | PASS | 2 arcs for 3/3 links, 1 merged |
| portrait 412x915 | arcs: focus = method | PASS | 2 arcs for 2/2 links |
| portrait 412x915 | arcs: focus = root folder, Dependencies on | PASS | 124 arcs for 449/449 links, 91 merged |
| portrait 412x915 | arcs: root folder merges many imports into thicker arcs | PASS | 91 merged arcs, 124 total |
| portrait 412x915 | arcs: focus = a depth-2 folder, Dependencies on | PASS | 68 arcs for 72/72 links, 4 merged |
| portrait 412x915 | arcs: pulse runs source -> target (comet speed > 0 toward vT=1, source end dimmer) | PASS | {"speed":0.45,"dim":0.55} |
| portrait 412x915 | follow: arc end taps available on screen | PASS | 2 tappable arcs |
| portrait 412x915 | follow: tap the end of an arc: lands on the target | PASS | focus 19 expected 19, radius 0.0e+0 |
| portrait 412x915 | follow: tap the end of an arc: pushes the back stack | PASS | depth 0 -> 1 |
| portrait 412x915 | follow: tap the end of an arc: Back returns to the start | PASS | focus 8 expected 8, depth 0 |
| portrait 412x915 | follow: a focus with a tappable arc body that leaves the focus exists | PASS | {"leaves":0,"arrives":2} |
| portrait 412x915 | follow: tap the body of an arc that leaves the focus: lands on the target | PASS | focus 19 expected 19, radius 0.0e+0 |
| portrait 412x915 | follow: tap the body of an arc that leaves the focus: pushes the back stack | PASS | depth 0 -> 1 |
| portrait 412x915 | follow: arc body (leaves the focus): Back returns to the start | PASS | focus 8 expected 8, depth 0 |
| portrait 412x915 | follow: a focus with a tappable arc body that arrives at the focus exists | PASS | {"leaves":0,"arrives":2} |
| portrait 412x915 | follow: tap the body of an arc that arrives at the focus: lands on the target | PASS | focus 20 expected 20, radius 0.0e+0 |
| portrait 412x915 | follow: tap the body of an arc that arrives at the focus: pushes the back stack | PASS | depth 0 -> 1 |
| portrait 412x915 | follow: arc body (arrives at the focus): Back returns to the start | PASS | focus 14 expected 14, depth 0 |
| portrait 412x915 | follow: panel has link tabs | PASS | Code / Imports 2 / Imported by 2 / Called by 20 |
| portrait 412x915 | follow: panel list rows are >= 44 px tall | PASS | 48 px |
| portrait 412x915 | follow: panel list entry lands on the entry | PASS | focus "server.js" expected "server.js", radius 0.0e+0 |
| portrait 412x915 | follow: panel list entry pushes the back stack | PASS | depth 0 -> 1 |
| portrait 412x915 | follow: panel list entry: Back returns to the start | PASS | focus 8 expected 8, depth 0 |
| portrait 412x915 | follow: search rows are >= 40 px tall | PASS | 48 px |
| portrait 412x915 | follow: search result lands on the result | PASS | focus 4998 expected 4998 (client.py), radius 0.0e+0 |
| portrait 412x915 | follow: search result pushes the back stack | PASS | depth 0 -> 1 |
| portrait 412x915 | follow: search result: Back returns to the start | PASS | focus 0 expected 0, depth 0 |
| portrait 412x915 | follow: minimap tap: lands on the target | PASS | focus 3 expected 3, radius 0.0e+0 |
| portrait 412x915 | follow: minimap tap: pushes the back stack | PASS | depth 0 -> 1 |
| portrait 412x915 | follow: minimap tap: Back returns to the start | PASS | focus 0 expected 0, depth 0 |
| portrait 412x915 | follow: chain of 6 follows lands exactly each time | PASS | arc:19 > arc:51 > arc:41 > arc:5040 > arc:5011 > panel:5001 |
| portrait 412x915 | follow: back stack depth equals number of follows | PASS | 6 vs 6 |
| portrait 412x915 | follow: backing out retraces the chain and ends at the start with an empty stack | PASS | s12:11 < s17:16 < n41 < n51 < n19 < n8; end {"focus":8,"depth":0,"r":0} |
| portrait 412x915 | follow: Backspace on an empty stack goes to the parent | PASS |  |
| portrait 412x915 | cases: found links into closed files | PASS | 4 cases |
| portrait 412x915 | cases: closed file 4 (was closed: true) -> symbol 3: lands exactly on the symbol | PASS | {"focus":5048,"want":5048,"r":0,"depth":1,"pend":false} |
| portrait 412x915 | follow: closed file 4: Back returns to the start | PASS | focus 19 expected 19, depth 0 |
| portrait 412x915 | cases: closed file 3 (was closed: true) -> symbol 3: lands exactly on the symbol | PASS | {"focus":5027,"want":5027,"r":0,"depth":1,"pend":false} |
| portrait 412x915 | follow: closed file 3: Back returns to the start | PASS | focus 20 expected 20, depth 0 |
| portrait 412x915 | cases: closed file 3 (was closed: true) -> symbol 3: lands exactly on the symbol | PASS | {"focus":5015,"want":5015,"r":0,"depth":1,"pend":false} |
| portrait 412x915 | follow: closed file 3: Back returns to the start | PASS | focus 22 expected 22, depth 0 |
| portrait 412x915 | cases: closed file 7 (was closed: true) -> symbol 0: lands exactly on the symbol | PASS | {"focus":5028,"want":5028,"r":0,"depth":1,"pend":false} |
| portrait 412x915 | follow: closed file 7: Back returns to the start | PASS | focus 26 expected 26, depth 0 |
| portrait 412x915 | cases: arcs ending at a collapsed +N orb exist (from a focused file) | PASS | 2 found |
| portrait 412x915 | cases: follow an arc into orb 1476 (merges 1 links) | PASS | {"focus":3109,"r":0,"depth":1,"state":0,"expected":3109} |
| portrait 412x915 | cases: orb follow pushes the back stack | PASS |  |
| portrait 412x915 | follow: orb 1476: Back returns to the start | PASS | focus 8 expected 8, depth 0 |
| portrait 412x915 | cases: follow an arc into orb 3249 (merges 1 links) | PASS | {"focus":4754,"r":0,"depth":1,"state":0,"expected":4754} |
| portrait 412x915 | cases: orb follow pushes the back stack | PASS |  |
| portrait 412x915 | follow: orb 3249: Back returns to the start | PASS | focus 12 expected 12, depth 0 |
| portrait 412x915 | cases: self links dropped and duplicates merged (checked on every focus above) | PASS |  |
| portrait 412x915 (400-symbol cut) | cut: big file opens with at most 400 symbols (+ top-level block) | PASS | 400 symbol nodes |
| portrait 412x915 (400-symbol cut) | cut: symbol 420 has no node, symbol 10 has | PASS | 420: false, 10: true |
| portrait 412x915 (400-symbol cut) | cut: arcs from small.js to big.js exist | PASS | [{"b":2,"t":{"node":2},"links":[[1,0,0,420],[1,0,0,10]]},{"b":403,"t":{"fileId":0,"sym":5},"links":[[0,5,1,0]]}] |
| portrait 412x915 (400-symbol cut) | cut: following a link to symbol 420 (past the cut) lands exactly on the file, nothing pending | PASS | {"focus":2,"file":2,"r":0,"pend":false,"depth":1} |
| portrait 412x915 (400-symbol cut) | cut: Back returns to small.js | PASS |  |
| portrait 412x915 (400-symbol cut) | cut: a link to symbol 10 (inside the cut) lands exactly on it | PASS | {"focus":13,"want":13,"r":0} |
| portrait 412x915 (400-symbol cut) | cut: arc audit on the big file is clean | PASS | 3 arcs  |
| portrait 412x915 (400-symbol cut) | cut: edges of the 400-symbol galaxy match the prediction | PASS | 403 edges, 0.00 % stray, 0 missing |
| landscape 915x412 | edges: root: no stray edges | PASS | 1355 edges, 0/47001 stray px (0.00 %) |
| landscape 915x412 | edges: root: no missing edges | PASS | 46 near edges checked |
| landscape 915x412 | edges: a folder: no stray edges | PASS | 832 edges, 0/35609 stray px (0.00 %) |
| landscape 915x412 | edges: a folder: no missing edges | PASS | 49 near edges checked |
| landscape 915x412 | edges: file opened its galaxy (setup) | PASS | 15 symbol nodes |
| landscape 915x412 | edges: file open (symbols): no stray edges | PASS | 630 edges, 0/30284 stray px (0.00 %) |
| landscape 915x412 | edges: file open (symbols): no missing edges | PASS | 48 near edges checked |
| landscape 915x412 | edges: a symbol focused: no stray edges | PASS | 284 edges, 0/16815 stray px (0.00 %) |
| landscape 915x412 | edges: a symbol focused: no missing edges | PASS | 30 near edges checked |
| landscape 915x412 | edges: mid-glide (was animating: true) | PASS | 0.00 % stray, 0 missing |
| landscape 915x412 | edges: after the glide, two files open: no stray edges | PASS | 382 edges, 0/18498 stray px (0.00 %) |
| landscape 915x412 | edges: after the glide, two files open: no missing edges | PASS | 38 near edges checked |
| landscape 915x412 | edges: files closed again after leaving (no leftover galaxies) | PASS | {"open":0,"dyn":0} |
| landscape 915x412 | edges: after 20 files opened and closed, back at root: no stray edges | PASS | 966 edges, 0/39758 stray px (0.00 %) |
| landscape 915x412 | edges: after 20 files opened and closed, back at root: no missing edges | PASS | 46 near edges checked |
| landscape 915x412 | arcs: found sample foci (file, class, method, function) | PASS | {"file":[0,-2],"func":[0,0],"cls":[2,0],"method":[2,2]} |
| landscape 915x412 | arcs: focus = file | PASS | 7 arcs for 25/25 links, 2 merged |
| landscape 915x412 | arcs: focus = func | PASS | 3 arcs for 21/21 links, 2 merged |
| landscape 915x412 | arcs: focus = cls | PASS | 2 arcs for 3/3 links, 1 merged |
| landscape 915x412 | arcs: focus = method | PASS | 2 arcs for 2/2 links |
| landscape 915x412 | arcs: focus = root folder, Dependencies on | PASS | 124 arcs for 449/449 links, 91 merged |
| landscape 915x412 | arcs: root folder merges many imports into thicker arcs | PASS | 91 merged arcs, 124 total |
| landscape 915x412 | arcs: focus = a depth-2 folder, Dependencies on | PASS | 68 arcs for 72/72 links, 4 merged |
| landscape 915x412 | arcs: pulse runs source -> target (comet speed > 0 toward vT=1, source end dimmer) | PASS | {"speed":0.45,"dim":0.55} |
| landscape 915x412 | follow: arc end taps available on screen | PASS | 7 tappable arcs |
| landscape 915x412 | follow: tap the end of an arc: lands on the target | PASS | focus 19 expected 19, radius 0.0e+0 |
| landscape 915x412 | follow: tap the end of an arc: pushes the back stack | PASS | depth 0 -> 1 |
| landscape 915x412 | follow: tap the end of an arc: Back returns to the start | PASS | focus 8 expected 8, depth 0 |
| landscape 915x412 | follow: a focus with a tappable arc body that leaves the focus exists | PASS | {"leaves":2,"arrives":3} |
| landscape 915x412 | follow: tap the body of an arc that leaves the focus: lands on the target | PASS | focus 5001 expected 5001, radius 0.0e+0 |
| landscape 915x412 | follow: tap the body of an arc that leaves the focus: pushes the back stack | PASS | depth 0 -> 1 |
| landscape 915x412 | follow: arc body (leaves the focus): Back returns to the start | PASS | focus 14 expected 14, depth 0 |
| landscape 915x412 | follow: a focus with a tappable arc body that arrives at the focus exists | PASS | {"leaves":2,"arrives":3} |
| landscape 915x412 | follow: tap the body of an arc that arrives at the focus: lands on the target | PASS | focus 20 expected 20, radius 0.0e+0 |
| landscape 915x412 | follow: tap the body of an arc that arrives at the focus: pushes the back stack | PASS | depth 0 -> 1 |
| landscape 915x412 | follow: arc body (arrives at the focus): Back returns to the start | PASS | focus 19 expected 19, depth 0 |
| landscape 915x412 | follow: panel has link tabs | PASS | Code / Imports 2 / Imported by 2 / Called by 20 |
| landscape 915x412 | follow: panel list rows are >= 44 px tall | PASS | 48 px |
| landscape 915x412 | follow: panel list entry lands on the entry | PASS | focus "server.js" expected "server.js", radius 0.0e+0 |
| landscape 915x412 | follow: panel list entry pushes the back stack | PASS | depth 0 -> 1 |
| landscape 915x412 | follow: panel list entry: Back returns to the start | PASS | focus 8 expected 8, depth 0 |
| landscape 915x412 | follow: search rows are >= 40 px tall | PASS | 40 px |
| landscape 915x412 | follow: search result lands on the result | PASS | focus 4998 expected 4998 (client.py), radius 0.0e+0 |
| landscape 915x412 | follow: search result pushes the back stack | PASS | depth 0 -> 1 |
| landscape 915x412 | follow: search result: Back returns to the start | PASS | focus 0 expected 0, depth 0 |
| landscape 915x412 | follow: minimap tap: lands on the target | PASS | focus 3 expected 3, radius 0.0e+0 |
| landscape 915x412 | follow: minimap tap: pushes the back stack | PASS | depth 0 -> 1 |
| landscape 915x412 | follow: minimap tap: Back returns to the start | PASS | focus 0 expected 0, depth 0 |
| landscape 915x412 | follow: chain of 6 follows lands exactly each time | PASS | arc:19 > arc:14 > arc:20 > arc:524 > arc:518 > arc:5031 |
| landscape 915x412 | follow: back stack depth equals number of follows | PASS | 6 vs 6 |
| landscape 915x412 | follow: backing out retraces the chain and ends at the start with an empty stack | PASS | n518 < n524 < n20 < n14 < n19 < n8; end {"focus":8,"depth":0,"r":0} |
| landscape 915x412 | follow: Backspace on an empty stack goes to the parent | PASS |  |
| landscape 915x412 | cases: found links into closed files | PASS | 4 cases |
| landscape 915x412 | cases: closed file 4 (was closed: true) -> symbol 3: lands exactly on the symbol | PASS | {"focus":5034,"want":5034,"r":0,"depth":1,"pend":false} |
| landscape 915x412 | follow: closed file 4: Back returns to the start | PASS | focus 19 expected 19, depth 0 |
| landscape 915x412 | cases: closed file 3 (was closed: true) -> symbol 3: lands exactly on the symbol | PASS | {"focus":5027,"want":5027,"r":0,"depth":1,"pend":false} |
| landscape 915x412 | follow: closed file 3: Back returns to the start | PASS | focus 20 expected 20, depth 0 |
| landscape 915x412 | cases: closed file 3 (was closed: true) -> symbol 3: lands exactly on the symbol | PASS | {"focus":5019,"want":5019,"r":0,"depth":1,"pend":false} |
| landscape 915x412 | follow: closed file 3: Back returns to the start | PASS | focus 22 expected 22, depth 0 |
| landscape 915x412 | cases: closed file 7 (was closed: true) -> symbol 0: lands exactly on the symbol | PASS | {"focus":5012,"want":5012,"r":0,"depth":1,"pend":false} |
| landscape 915x412 | follow: closed file 7: Back returns to the start | PASS | focus 26 expected 26, depth 0 |
| landscape 915x412 | cases: arcs ending at a collapsed +N orb exist (from a focused file) | PASS | 2 found |
| landscape 915x412 | cases: follow an arc into orb 1476 (merges 1 links) | PASS | {"focus":3109,"r":0,"depth":1,"state":0,"expected":3109} |
| landscape 915x412 | cases: orb follow pushes the back stack | PASS |  |
| landscape 915x412 | follow: orb 1476: Back returns to the start | PASS | focus 8 expected 8, depth 0 |
| landscape 915x412 | cases: follow an arc into orb 3249 (merges 1 links) | PASS | {"focus":4754,"r":0,"depth":1,"state":0,"expected":4754} |
| landscape 915x412 | cases: orb follow pushes the back stack | PASS |  |
| landscape 915x412 | follow: orb 3249: Back returns to the start | PASS | focus 12 expected 12, depth 0 |
| landscape 915x412 | cases: self links dropped and duplicates merged (checked on every focus above) | PASS |  |
| landscape 915x412 (400-symbol cut) | cut: big file opens with at most 400 symbols (+ top-level block) | PASS | 400 symbol nodes |
| landscape 915x412 (400-symbol cut) | cut: symbol 420 has no node, symbol 10 has | PASS | 420: false, 10: true |
| landscape 915x412 (400-symbol cut) | cut: arcs from small.js to big.js exist | PASS | [{"b":2,"t":{"node":2},"links":[[1,0,0,420],[1,0,0,10]]},{"b":403,"t":{"fileId":0,"sym":5},"links":[[0,5,1,0]]}] |
| landscape 915x412 (400-symbol cut) | cut: following a link to symbol 420 (past the cut) lands exactly on the file, nothing pending | PASS | {"focus":2,"file":2,"r":0,"pend":false,"depth":1} |
| landscape 915x412 (400-symbol cut) | cut: Back returns to small.js | PASS |  |
| landscape 915x412 (400-symbol cut) | cut: a link to symbol 10 (inside the cut) lands exactly on it | PASS | {"focus":13,"want":13,"r":0} |
| landscape 915x412 (400-symbol cut) | cut: arc audit on the big file is clean | PASS | 3 arcs  |
| landscape 915x412 (400-symbol cut) | cut: edges of the 400-symbol galaxy match the prediction | PASS | 403 edges, 0.00 % stray, 0 missing |
| desktop 1000x800 | hover: a hoverable file with links is on screen | PASS | {"id":8,"x":545.9566284825546,"y":260.29732726780975,"n":6} |
| desktop 1000x800 | hover: real mouse hover previews the file's arcs (<= 300 total, audit clean) | PASS | 6 hover arcs of 6 |
| desktop 1000x800 | hover: moving the mouse away removes the preview | PASS | 0 hover arcs left |
| desktop mouse 1280x800 | toolbar: one row (all buttons share one top) with no Back | PASS | {"top":680,"height":44} |
| desktop mouse 1280x800 | toolbar: Back is showing (depth >= 1) | PASS | depth 1 |
| desktop mouse 1280x800 | toolbar: still one row with Back showing, same top and height | PASS | {"before":[680,44],"after":[680,44]} |
| desktop mouse 1280x800 | toolbar: Back appearing moves no other button | PASS |  |
| desktop mouse 1280x800 | toolbar: no focus-arc end or body point lies under a toolbar button (Back showing) | PASS | [] |
| desktop mouse 1280x800 | mouse: arc points to click exist on screen | PASS | 40 points |
| desktop mouse 1280x800 | mouse: 14 real clicks on arc ends and bodies (whole length) each follow the nearest arc, Back showing | PASS | 14 ok, 0 skipped |
| desktop mouse 1280x800 | mouse: some focus has arc points that are also over a different node | PASS | file 0: 30 points |
| desktop mouse 1280x800 | mouse: a click on an arc line over another node follows the arc, not the node | PASS | 6 ok |
| desktop mouse 1280x800 | mouse: clicking the focus itself follows no arc | PASS |  |
| shots | shots: found a file with three followable arcs on screen | PASS | {"fileId":2,"idx":[2,15,13]} |
| shots | shots: arc 1 captured mid-glide | PASS | file 2 arc 2 (call, conf 0.800000011920929) at ~3000 ms of a 10 s slowed glide |
| shots | shots: arc 2 captured mid-glide | PASS | file 2 arc 15 (call, conf 0.699999988079071) at ~5000 ms of a 10 s slowed glide |
| shots | shots: arc 3 captured mid-glide | PASS | file 2 arc 13 (call, conf 0.699999988079071) at ~7000 ms of a 10 s slowed glide |
| console | no console errors or exceptions during the whole run | PASS |  |

172 / 172 checks passed