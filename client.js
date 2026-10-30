window.__ModuleLoader__.load({
	id: "@local/dsh-thinking-effort-rheostat",
	factory: (require) => {
		const React = require("react");
		const h = React.createElement;
		const Fragment = React.Fragment;
		const useState = React.useState;
		const useEffect = React.useEffect;
		const useLayoutEffect = React.useLayoutEffect;
		const useRef = React.useRef;
		const useMemo = React.useMemo;
		const useCallback = React.useCallback;
		const useSyncExternalStore = React.useSyncExternalStore;

		/** Dictionary namespace owned by this plugin. */
		const NS = "thinking-effort";
		const PACKAGE = "@local/dsh-thinking-effort-rheostat";
		const STYLE_ID = PACKAGE + "/client.css";

		/** Rail geometry, shared by layout and pointer math. */
		const PAD = 13;
		const THUMB_W = 26;
		const THUMB_H = 22;
		const PANEL_W = 272;
		const GAP_ABOVE_CHIP = 8;

		/**
		 * Labels that identify the shipped model menu's effort row.
		 *
		 * This plugin owns the effort control, so the shipped row and the level
		 * suffix on the trigger are both removed rather than shown twice. They are
		 * matched by label, not by class: the shipped classes are hashed and change
		 * between builds, and these strings are the very ones the panel heading
		 * already uses.
		 */
		const MENU_EFFORT_LABELS = ["推理等级", "Effort"];

		/**
		 * Highest tier's square-field lattice.
		 *
		 * Six rows, not five: the field has to cover the whole groove, and the
		 * rail is 30px tall with a 2px inset, so six 3px rows only fit with a 1px
		 * gap (6x3 + 5x1 = 23 of the 26 available). The tighter gap is also what
		 * makes it read as a surface rather than a grid of dots.
		 */
		const FIELD_ROWS = 6;
		const FIELD_CELL = 3;
		const FIELD_GAP = 1;

		/**
		 * Rail palette: a LIGHT blue groove with the brand blue consumed.
		 *
		 * Two earlier palettes were wrong in the same direction: the groove was
		 * the dark element (an ink wash, then a navy fill), so the whole control
		 * read as a dark bar. The relationship is inverted here — the groove is
		 * the light tint and the fill is DeepSeek's own `#5686fe`.
		 *
		 * The groove is a tint of the brand blue over the panel surface, not a
		 * fixed literal, so it follows the theme without a single theme branch:
		 * 26% of #5686fe over white is a pale blue, and the same recipe over
		 * #232324 is a deep blue. The key is white, which needs a groove it can
		 * stand off in BOTH themes — that is what the two mixes give it, and
		 * tools/contrast.js measures both.
		 *
		 * The key over the pale groove leans on its ring and shadow (native
		 * sliders all do); over the brand-blue fill it clears 3:1 on its own.
		 * The gate encodes exactly that split rather than pretending otherwise.
		 */
		const BRAND = "#5686fe";        /* DeepSeek logo blue: the consumed portion */
		/* The groove is a faint tint, not a slab: the key and the filled bar carry
		   the meaning, the groove only has to say "a track runs here". Lowered
		   from 26% after the first pass still read as dark; the floor is what
		   keeps it from disappearing, and tools/contrast.js measures it. */
		const GROOVE_MIX = 14;          /* % of brand in the groove, over the panel */
		const GROOVE_IDLE_MIX = 9;      /* no declared ladder: a fainter groove */
		const FILL_MIX = 42;            /* consumed portion: a tint, not a slab */
		const FILL_MAX_MIX = 58;        /* highest tier: a shade firmer */
		/* The key is white in BOTH themes, and that is forced rather than chosen:
		   the rail is dark in the dark theme, so a key that contrasts with a pale
		   light-mode rail (a blue one) measures 1.1–1.3:1 against the dark one.
		   White clears 12:1 there, and leans on its ring over the pale rail. The
		   brand blue therefore lives in the fill and the ticks, not the key. */
		const THUMB_FILL = "#ffffff";
		/* Unlit stops: the brand at 80%, which is the one value that clears its
		   floor on BOTH grooves — a pale light-mode tint and a lifted dark-mode
		   one. A single mid-tone cannot, and two recipes would mean a theme
		   branch. */
		const TICK = "rgba(86,134,254,.80)";
		const TICK_ON = "#ffffff";             /* reached stops, on the blue fill */
		/* The key's elevation, tinted with the groove's own ink instead of black:
		   a black shadow over pale blue reads as dirt, while a blue-grey one reads
		   as depth. */
		const THUMB_RING = "rgba(30,48,96,.34)";
		const THUMB_DROP = "rgba(30,42,80,.30)";
		const THUMB_LIFT = "rgba(30,42,80,.20)";
		/* The groove's own edge, which carries its definition once the tint is
		   faint enough to read as "light". */
		const RAIL_EDGE = "rgba(43,58,103,.16)";
		const RAIL_INSET = "rgba(30,42,80,.08)";
		/* Lifts the groove on the dark theme without a theme branch: a thin white
		   wash over the mix barely moves a pale light-mode tint (it is already
		   near the top of the range) and visibly raises a deep dark-mode one. */
		const RAIL_LIFT = "rgba(255,255,255,.14)";

		/**
		 * The default ladder drawn while a model declares no ladder of its own.
		 *
		 * `dsh-llm-pi-ai` omits `reasoning` entirely for a model without
		 * reasoning metadata, and `dsh-llm` reads that omission as the capability
		 * being unavailable: `resolveCallWithInfo` throws
		 * `UNSUPPORTED_REASONING_EFFORT` for any explicit effort, and
		 * `session/selectModel` runs the same check. So these stops are NOT
		 * submittable and the rail that draws them is deliberately inert — they
		 * are a preview of what declaring the ladder would unlock.
		 *
		 * The ids are the set the Host half writes when no customization is
		 * requested (`DECLARED_EFFORTS` in `config-declare.js`). The two
		 * halves are separate bundles and cannot import each other, so
		 * `tools/smoke-declare.mjs` asserts the mirror stays identical.
		 */
		const PREVIEW_LEVELS = [
			{ id: "low", name: "Low" },
			{ id: "medium", name: "Medium" },
			{ id: "high", name: "High" },
			{ id: "xhigh", name: "Xhigh" },
			{ id: "max", name: "Max" }
		];

		/**
		 * The full level vocabulary a declaration may offer, escalation order.
		 *
		 * `THINKING_LEVELS` in `dsh-llm-pi-ai` is exactly these seven — the
		 * declaration chooser offers every one of them, `off` included (an
		 * `off` stop sends no parameter at all, which is the point of declaring
		 * it). The names match what a decision turns into after declaring:
		 * `reasoningInfo` synthesizes the familiar TitleCase of each id, so the
		 * preview and the live rail spell a level identically.
		 *
		 * The ids mirror `LEVEL_IDS` in `bundle/config-declare.js`; the mirror
		 * is asserted by `tools/smoke-declare.mjs`.
		 */
		const VOCAB_LEVELS = [
			{ id: "off", name: "Off" },
			{ id: "minimal", name: "Minimal" },
			{ id: "low", name: "Low" },
			{ id: "medium", name: "Medium" },
			{ id: "high", name: "High" },
			{ id: "xhigh", name: "Xhigh" },
			{ id: "max", name: "Max" }
		];

		/** Host route that reports and writes a model's declared ladder. */
		const DECLARE_ROUTE = "/thinking-effort/levels";
		/** Host route that answers "what does models.dev know about this model name". */
		const MODELSDEV_ROUTE = "/thinking-effort/modelsdev";

		/** The ids of {@link VOCAB_LEVELS}, for membership tests without re-deriving the array. */
		const VOCAB_IDS = VOCAB_LEVELS.map((level) => level.id);
		/** Default wire spelling for a level: its own name, unless customized per row. */
		const DEFAULT_PREVIEW_IDS = PREVIEW_LEVELS.map((level) => level.id);

		const DICT = {
			zh: {
				label: "思考强度",
				"axis.faster": "更快",
				"axis.smarter": "更聪明",
				help: "档位由当前模型自己提供；没有档位的模型可以一键启用（推荐组合来自 models.dev，也可自定义）。档位越高，作答前投入的推理越多：更慢、思考 token 更多，复杂任务上通常更准。",
				"effort.providerDefault": "模型默认",
				"state.failed": "当前模型不接受这个档位，已还原上一档",
				"state.stranded": "当前档位已不可用，请重置为模型默认",
				"state.undeclared": "该模型没有思考档位",
				"state.unmanageable": "，且无法在此启用",
				"state.nonreasoning": "该模型已被声明为不支持思考",
				"state.ours": "档位已由「思考强度」启用",
				"act.declare": "一键启用",
				"act.custom": "自定义…",
				"act.revert": "撤销启用",
				"act.reset": "重置档位",
				"act.pending": "启用中…",
				"act.failed": "启用失败：{detail}",
				"cho.source": "模型",
				"cho.search": "查询",
				"cho.checking": "正在查询 models.dev…",
				"cho.matched": "{provider} 下的 {count} 个匹配：",
				"cho.matchCount": "匹配",
				"cho.offers": "可选档位：{values}",
				"cho.noMatch": "models.dev 未收录这个名字，可手动勾选档位",
				"cho.fetchNoData": "models.dev 查询失败，可手动勾选档位",
				"cho.levels": "档位",
				"cho.adv": "自定义发送值…",
				"cho.wires": "发送值",
				"cho.wirePlaceholder": "发送到网关的参数值",
				"cho.offHint": "关闭：不发送推理参数",
				"cho.apply": "启用（{count} 档）",
				"cho.cancel": "取消",
				"cho.none": "至少选择一个档位",
				"cho.wireEmpty": "非关闭档位的发送值不能为空",
				"why.route-missing": "配置文件里没有这个供应商",
				"why.models-replaced": "该供应商的模型不是逐条声明的",
				"why.model-missing": "配置文件里没有这个模型",
				"why.not-ours": "这些档位不是本插件启用的",
				"why.editor-missing": "当前组合没有配置编辑器",
				"why.bad-request": "请求不完整",
				"why.bad-action": "不认识这个操作",
				"why.bad-levels": "档位组合无效：键必须是官方档位，「关闭」档为空、其余档需要非空的发送值",
				"why.write-failed": "写入配置文件失败",
				"why.fence-missing": "宿主尚未就绪，请稍后重试",
				"why.fetch-failed": "无法从 models.dev 拉取模型目录",
				"why.no-fetch": "当前环境没有 fetch，可手动勾选档位",
				"a11y.value": "{name}，第 {index} 档，共 {count} 档"
			},
			en: {
				label: "Effort",
				"axis.faster": "Faster",
				"axis.smarter": "Smarter",
				help: "The levels come from the model itself; models without one can be enabled with one click (the suggestion comes from models.dev, or pick a custom set). A higher level spends more reasoning before answering: slower, more thinking tokens, usually more accurate on hard tasks.",
				"effort.providerDefault": "Provider default",
				"state.failed": "This model does not accept that level — restored the previous one",
				"state.stranded": "The current level is no longer available — reset it to the model default",
				"state.undeclared": "This model has no thinking levels",
				"state.unmanageable": " and none can be enabled here",
				"state.nonreasoning": "This model is declared as not supporting thinking",
				"state.ours": "Levels enabled by Effort",
				"act.declare": "Enable levels",
				"act.custom": "Customize…",
				"act.revert": "Remove levels",
				"act.reset": "Reset level",
				"act.pending": "Enabling…",
				"act.failed": "Enabling failed: {detail}",
				"cho.source": "Model",
				"cho.search": "Look up",
				"cho.checking": "Querying models.dev…",
				"cho.matched": "{count} matches under {provider}:",
				"cho.matchCount": "Matches",
				"cho.offers": "Offers: {values}",
				"cho.noMatch": "models.dev does not list this name; pick levels by hand",
				"cho.fetchNoData": "The models.dev query failed; pick levels by hand",
				"cho.levels": "Levels",
				"cho.adv": "Custom sent values…",
				"cho.wires": "Sent values",
				"cho.wirePlaceholder": "the value sent over the wire",
				"cho.offHint": "Off: no reasoning parameter is sent",
				"cho.apply": "Enable ({count})",
				"cho.cancel": "Cancel",
				"cho.none": "Select at least one level",
				"cho.wireEmpty": "A non-off level needs a non-empty sent value",
				"why.route-missing": "the profile has no such provider",
				"why.models-replaced": "that provider does not declare its models one by one",
				"why.model-missing": "the profile has no such model",
				"why.not-ours": "these levels were not enabled by this plugin",
				"why.editor-missing": "this composition mounts no configuration editor",
				"why.bad-request": "incomplete request",
				"why.bad-action": "unknown operation",
				"why.bad-levels": "invalid level set: keys must be official levels, with off empty and every other level carrying a non-empty sent value",
				"why.write-failed": "the profile write failed",
				"why.fence-missing": "the host is not ready yet; try again shortly",
				"why.fetch-failed": "could not fetch the models.dev catalogue",
				"why.no-fetch": "no fetch is available here; pick the levels by hand",
				"a11y.value": "{name}, level {index} of {count}"
			}
		};

		/* ------------------------------------------------------------------ *
		 * Stylesheet, ported value-for-value from the design prototype.
		 *
		 * Every colour here comes from a `--dsw-alias-*` theme token, so the
		 * control follows light and dark automatically. An earlier version
		 * branched on a `body[data-ds-dark-theme]` attribute and shipped a white
		 * thumb on a pale rail inside the dark theme, because that attribute is
		 * not what this build sets. Tokens cannot drift that way: a renamed token
		 * degrades the appearance instead of producing an unreadable control.
		 * ------------------------------------------------------------------ */
		const CSS = [
			/* ---- trigger: one compact slider control, not a staircase readout ----
			   Keep the model seat's 28px height, type ramp and text tone. A subtle
			   token-only boundary groups our slider icon, active level and disclosure
			   into ONE target instead of a loose icon/value beside the model name.
			   The text can shrink; both icons keep their proportions. The full level
			   remains in the accessible name and tooltip when the row is narrow.

			   `order:1` keeps this cell after the model seat within the composer's
			   shared flex row. No wrapper, external DOM writes or layout probing. */
			".te-chip{box-sizing:border-box;border-radius:var(--dsw-radius-sm,8px);height:28px;",
			"max-width:min(160px,32cqw);padding:0 8px;",
			"color:var(--dsw-alias-label-secondary);",
			"cursor:pointer;background:color-mix(in srgb,var(--dsw-alias-label-secondary) 4%,transparent);",
			"border:1px solid var(--dsw-alias-border-l1);outline:none;order:1;",
			"align-items:center;gap:6px;display:flex;flex:0 1 auto;min-width:54px;",
			"font-family:inherit;font-size:13px;font-weight:400;line-height:20px;",
			"transition:background .16s ease}",
			".te-chip svg{display:block;flex:none;color:inherit}",
			".te-chipLabel{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;flex:0 1 auto}",
			".te-chipChevron{opacity:.65;transition:transform .16s ease}",
			".te-chip[aria-expanded=true] .te-chipChevron{transform:rotate(180deg)}",
			".te-chip:hover:not(:disabled),.te-chip[aria-expanded=true]{background:var(--dsw-alias-interactive-bg-hover)}",
			".te-chip:focus-visible{box-shadow:0 0 0 2px var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary))}",

			/* ---- take the level display out of the shipped model seat ----
			   This plugin owns the effort control, so the model trigger must stop
			   printing its own "· High/Max" suffix; two readouts of one value, with
			   two ways to change it, is the duplication being removed.

			   The trigger's class is a hashed CSS-module name, so it is matched by
			   structure that the shipped markup keeps: inside the composer card,
			   a menu button whose direct span children are the model label
			   (carrying `data-provider-id`) and, after it, the effort suffix (no
			   such attribute). `:not(:first-of-type)` protects the fallback label,
			   which is also attribute-less and is the FIRST span when no model is
			   resolved yet. If the markup ever changes, the rule matches nothing and
			   the suffix simply reappears — no broken layout. */
			'[data-composer-card] button[aria-haspopup="menu"] > span:not([data-provider-id]):not(:first-of-type)',
			'{display:none}',

			/* ---- panel ----
			   Surface is `bg-layer-1` (a raised surface), not the popover token
			   `bg-overlay`: in dark mode that one resolves to a mid grey (#61666b)
			   where the accent only reaches 2.49:1 against it — measured, see
			   tools/contrast.js. On bg-layer-1 (#232324) the same accent reaches
			   6.75:1, and light mode gets a plain white card. */
			".te-panel{position:fixed;z-index:1100;box-sizing:border-box;width:" + PANEL_W + "px;",
			"padding:13px 13px 12px;border-radius:var(--dsw-radius-md,12px);",
			"background:var(--dsw-alias-bg-layer-1);border:.5px solid var(--dsw-alias-border-l2);",
			"box-shadow:var(--dsw-elevation-prominent);color:var(--dsw-alias-label-primary);",
			"font-size:13px;font-weight:400;line-height:20px;transform-origin:10px 100%;",
			"animation:te-in .26s cubic-bezier(.32,.72,0,1) both}",
			"@keyframes te-in{from{opacity:0;transform:translateY(5px) scale(.98)}to{opacity:1;transform:none}}",
			".te-head{display:flex;align-items:center;gap:6px;padding:0 1px}",
			".te-kicker{color:var(--dsw-alias-label-secondary);font-weight:500}",
			".te-tier{font-weight:600;letter-spacing:-.005em;color:var(--dsw-alias-label-primary);",
			"min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;transition:color .3s ease}",
			".te-tierMax{color:var(--dsw-alias-state-business-primary)}",
			".te-help{margin-left:auto;flex:none;width:15px;height:15px;padding:0;border:0;border-radius:50%;",
			"background:0 0;color:var(--dsw-alias-label-secondary);cursor:help;",
			"font-family:inherit;font-size:10px;font-weight:600;line-height:15px;",
			"text-align:center;position:relative;transition:color .16s,background .16s}",
			".te-help:hover,.te-help:focus-visible{color:var(--dsw-alias-label-primary);",
			"background:var(--dsw-alias-interactive-bg-hover);outline:none}",
			".te-helpTip{position:absolute;right:-2px;bottom:20px;width:212px;box-sizing:border-box;",
			"padding:8px 10px;border-radius:9px;background:var(--dsw-alias-bg-layer-2);",
			"border:.5px solid var(--dsw-alias-border-l2);box-shadow:var(--dsw-elevation-prominent);",
			"color:var(--dsw-alias-label-secondary);text-align:left;",
			"font-family:inherit;font-size:11px;font-weight:400;line-height:1.6;",
			"opacity:0;pointer-events:none;transition:opacity .16s ease;z-index:1}",
			".te-help:hover .te-helpTip,.te-help:focus-visible .te-helpTip{opacity:1}",
			".te-axis{display:flex;justify-content:space-between;margin:12px 1px 6px;",
			"font-size:11.5px;font-weight:500;color:var(--dsw-alias-label-secondary)}",

			/* ---- rail: a faint blue groove, brand-blue when consumed ----
			   Earlier attempts made the groove the DARK element — an ink wash,
			   then a navy fill — and the control read as a dark bar. The tint is
			   built from the brand blue over the panel surface instead, so it is
			   pale on the light theme and deep on the dark one with no theme
			   branch. tools/contrast.js resolves both mixes.
			   The groove is kept deliberately faint, so its EDGE does the work a
			   darker fill used to: a hairline ring plus a soft inner shadow. That
			   is also how a native track is drawn on a light surface. */
			".te-rail{position:relative;height:30px;border-radius:9px;",
			"background:linear-gradient(" + RAIL_LIFT + "," + RAIL_LIFT + "),",
			"color-mix(in oklab," + BRAND + " " + GROOVE_MIX + "%,var(--dsw-alias-bg-layer-1));",
			"box-shadow:inset 0 0 0 .5px " + RAIL_EDGE + ",inset 0 1px 2px " + RAIL_INSET + ";",
			"cursor:pointer;user-select:none;touch-action:none}",
			".te-railDrag{cursor:grabbing}",
			/* A model with no declared ladder cannot accept a level — the Host
			   refuses it before provider I/O — so the rail stops pretending. It
			   keeps its geometry and shows where the declared stops would land. */
			".te-railIdle{cursor:default;background:color-mix(in oklab," +
			BRAND + " " + GROOVE_IDLE_MIX + "%,var(--dsw-alias-bg-layer-1))}",
			".te-railIdle .te-fill,.te-railIdle .te-thumb{display:none}",
			".te-railIdle .te-tick{opacity:.30}",

			/* The consumed portion is a TINT of the brand, not the brand at full
			   strength: a solid saturated bar over most of the rail is what read as
			   "still too dark". The brand blue is carried by the key instead, which
			   is the small element it belongs on. */
			".te-fill{position:absolute;left:4px;top:4px;bottom:4px;border-radius:6px;",
			"background:color-mix(in oklab," + BRAND + " " + FILL_MIX + "%,var(--dsw-alias-bg-layer-1));",
			/* The settled glide carries the same spring curve and the same span
			   as the key, so the two move as one piece — and the overshoot it
			   allows stays inside the rail (the fill's far edge never passes
			   the thumb's relaxation point by more than the key overshoots). */
			"transition:width .45s cubic-bezier(.3,1.3,.4,1),opacity .3s ease}",
			".te-max .te-fill{background:color-mix(in oklab," + BRAND + " " + FILL_MAX_MIX +
			"%,var(--dsw-alias-bg-layer-1))}",

			/* Reached stops are white on the blue fill; the stops not yet reached
			   are a transparent blue on the pale groove, so they stay visible
			   without drawing attention. */
			".te-tick{position:absolute;top:50%;width:4px;height:4px;border-radius:1.2px;",
			"background:" + TICK + ";transform:translate(-50%,-50%);",
			"transition:background .25s ease,opacity .25s ease}",
			".te-tickOn{background:" + TICK_ON + ";opacity:1}",
			".te-max .te-tick{opacity:0}",

			/* ---- the lattice lights the hall only at the top stop ----
			   The squares belong to the maximum tier alone, but leaving it must
			   not snap. One element carries the whole field, parked fully dark
			   the moment the settled value is not the maximum; the polish lives
			   at the boundary between the top two stops, where two things
			   happen at once. `--te-line` — the thumb's clip line in field
			   coordinates — exposes exactly the columns the current drag still
			   covers, so nothing survives to the right of the thumb as it
			   leaves the maximum. And the field's opacity is a smoothstep ramp
			   over that same zone, painted raw with each move, so the hall
			   melts away (and re-lights when the thumb climbs back) instead of
			   popping. Parked below the top stop both the clip and the glow
			   collapse to zero, and the twinkles of a dark field are paused so
			   an invisible lattice never burns idle time. Transitions outside
			   a drag give every settle the same dissolve; the reveal at the
			   top stop unfolds the sheet right to left, out from under the parked
			   key — and the left-fade mask still reads as
			   energy entering from the right. */
			".te-field{position:absolute;inset:2px 4px;border-radius:6px;overflow:hidden;display:grid;",
			"align-content:center;justify-content:space-between;gap:" + FIELD_GAP + "px;",
			"pointer-events:none;opacity:0;",
			"clip-path:inset(0 calc(100% - var(--te-line,0px)) 0 0);",
			"transition:opacity .3s ease,clip-path .55s cubic-bezier(.4,0,.2,1);",
			"-webkit-mask-image:linear-gradient(to left,#000 0%,#000 26%,rgba(0,0,0,.62) 52%,rgba(0,0,0,.3) 74%,rgba(0,0,0,.08) 90%,transparent 100%);",
			"mask-image:linear-gradient(to left,#000 0%,#000 26%,rgba(0,0,0,.62) 52%,rgba(0,0,0,.3) 74%,rgba(0,0,0,.08) 90%,transparent 100%)}",
			/* Same idea inside a drag: no queued glide while paints write every
			   move — and the fill follows the hand raw like the thumb does. */
			".te-railDrag .te-field,.te-railDrag .te-fill{transition:none}",
			".te-cell{display:block;width:" + FIELD_CELL + "px;height:" + FIELD_CELL + "px;border-radius:1px;",
			"background:#fff;opacity:var(--te-o,.78)}",
			".te-cellBlink{animation:te-twinkle var(--te-d,2.4s) linear var(--te-dl,0s) infinite;animation-play-state:var(--te-run,paused)}",
			/* Each cell carries its own base opacity, so even the cells that are
			   not twinkling form an uneven texture instead of a grid. */
			"@keyframes te-twinkle{0%{opacity:calc(var(--te-o,.78) * .30)}6%{opacity:1}17%{opacity:calc(var(--te-o,.78) * .42)}",
			"31%{opacity:.95}46%{opacity:calc(var(--te-o,.78) * .34)}62%{opacity:1}",
			"77%{opacity:calc(var(--te-o,.78) * .45)}91%{opacity:.9}100%{opacity:calc(var(--te-o,.78) * .30)}}",

			/* ---- thumb: a white key ----
			   White is the only fill that works in both themes (see THUMB_FILL).
			   Over the dark theme's rail it clears 3:1 on luminance alone; over the
			   pale light-mode rail it cannot, so there the ring and the two shadow
			   layers carry it — the same way a native slider key is drawn.
			   tools/contrast.js accepts either mechanism and requires one. */
			".te-thumb{position:absolute;top:50%;left:0;width:" + THUMB_W + "px;height:" + THUMB_H + "px;",
			"margin-top:" + (-THUMB_H / 2) + "px;padding:0;border:0;border-radius:7px;",
			"background:" + THUMB_FILL + ";",
			"box-shadow:0 0 0 1px " + THUMB_RING + ",0 1px 2px " + THUMB_DROP + "," +
			"0 3px 8px " + THUMB_LIFT + ";",
			"cursor:grab;outline:none;",
			/* The key springs: a quick launch, a small hop past the stop, a
			   settle back. The curve allows about a five percent overshoot so
			   a full-rail leap never leaves the track, while one-notch hops
			   still show a visible bounce. */
			"transition:box-shadow .3s ease,transform .45s cubic-bezier(.3,1.3,.4,1)}",
			".te-railDrag .te-thumb{cursor:grabbing;transition:box-shadow .3s ease}",
			".te-thumb:focus-visible{box-shadow:0 0 0 2px var(--dsw-alias-bg-layer-1)," +
			"0 0 0 4px var(--dsw-alias-state-business-primary)}",
			".te-max .te-thumb{box-shadow:" +
			"0 0 0 1px " + THUMB_RING + ",0 1px 2px " + THUMB_DROP + ",0 3px 8px " + THUMB_LIFT + "," +
			"0 0 16px 2px color-mix(in oklab," + BRAND + " 65%,transparent)}",
			".te-err .te-thumb{animation:te-shake .32s ease}",
			"@keyframes te-shake{0%,100%{margin-left:0}30%{margin-left:-2px}70%{margin-left:2px}}",

			/* ---- the revert farewell: the key's ghost ----
			   Removing a declaration swaps the live rail for the idle preview,
			   which hides the key and the fill outright — a hard flash where a
			   spring used to be. The ghost spawns where the key last rested,
			   springs home to the rail's left rest while fading, and retires:
			   undoing reads as the same motion a level change gets. */
			".te-ghost{position:absolute;top:50%;left:0;width:" + THUMB_W + "px;height:" + THUMB_H + "px;",
			"margin-top:" + (-THUMB_H / 2) + "px;border-radius:7px;background:" + THUMB_FILL + ";",
			"box-shadow:0 0 0 1px " + THUMB_RING + ",0 1px 2px " + THUMB_DROP + ",0 3px 8px " + THUMB_LIFT + ";",
			"pointer-events:none;opacity:0;",
			"transition:transform .45s cubic-bezier(.3,1.3,.4,1),opacity .3s ease}",
			".te-ghostFill{position:absolute;left:4px;top:4px;bottom:4px;border-radius:6px;",
			"background:color-mix(in oklab," + BRAND + " " + FILL_MIX + "%,var(--dsw-alias-bg-layer-1));",
			"pointer-events:none;opacity:0;",
			"transition:width .45s cubic-bezier(.3,1.3,.4,1),opacity .3s ease}",

			/* ---- footer ----
			   The reserve belongs to the one state that needs it: a per-level
			   description changes length as the thumb moves, and an unreserved
			   footer makes the whole panel jump. A note or an error is a single
			   fixed line that never changes while the panel is open, so reserving
			   two lines there only printed an empty line under the text.
			   When neither a description nor an action exists — the common case
			   for a declared model, whose synthesized efforts carry no
			   description — the footer renders NOTHING at all: reserving its
			   geometry under an empty line left a bare blank strip that read as
			   a layout bug. */
			".te-foot{margin-top:9px;color:var(--dsw-alias-label-secondary);",
			"font-size:11px;line-height:16px}",
			".te-footDesc{min-height:32px}",
			".te-footErr{color:var(--dsw-alias-state-error-primary)}",
			/* A model that declared nothing is a fact, not a warning: a quiet lift
			   in contrast, never an alarm colour. */
			".te-footNote{color:var(--dsw-alias-label-primary)}",
			/* Inline text action inside the footer line — no pill, no second row. */
			".te-act{margin-left:6px;padding:0 5px;border:0;border-radius:4px;background:0 0;",
			"color:var(--dsw-alias-state-business-primary);",
			"font-family:inherit;font-size:11px;font-weight:500;line-height:16px;",
			"cursor:pointer;vertical-align:bottom;transition:background .16s ease,color .16s ease}",
			".te-act:hover:not(:disabled),.te-act:focus-visible{background:var(--dsw-alias-interactive-bg-hover);outline:none}",
			".te-act:disabled{color:var(--dsw-alias-label-tertiary);cursor:default}",
			/* The secondary affordance ("自定义…") sits beside the primary action:
			   same inline geometry, but tertiary ink — the one-click enable is
			   the path a human walks, picking level by level is the detour. */
			".te-footAlt{margin-left:4px;padding:0 5px;border:0;border-radius:4px;background:0 0;",
			"color:var(--dsw-alias-label-secondary);",
			"font-family:inherit;font-size:11px;font-weight:400;line-height:16px;",
			"cursor:pointer;vertical-align:bottom;transition:background .16s ease}",
			".te-footAlt:hover,.te-footAlt:focus-visible{background:var(--dsw-alias-interactive-bg-hover);outline:none}",
			".te-footAlt:disabled{color:var(--dsw-alias-label-tertiary);cursor:default}",

			/* ---- chooser: declare a CUSTOM ladder ----
			   Everything here reuses the trigger's token vocabulary (label tints,
			   layer-2 inputs, the business accent), so it follows both themes
			   without a single literal. Level chips are 22px tall pills that
			   wrap, wire inputs 22px rows. The wire rows and the catalogue
			   re-query both hide behind `.te-choAdv`: the default path asks only
			   "which levels", the spelling of each value is the expert detour. */
			".te-cho{margin-top:9px;border-top:.5px solid var(--dsw-alias-border-l2);",
			"padding-top:9px}",
			".te-choRow{display:flex;align-items:center;gap:6px;min-width:0}",
			".te-choRow+.te-choRow{margin-top:6px}",
			".te-choLbl{flex:none;color:var(--dsw-alias-label-secondary);font-size:11px;font-weight:500}",
			".te-choInput{flex:1;min-width:0;height:24px;margin:0;padding:0 8px;border:0;border-radius:6px;",
			"background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);",
			"font-family:inherit;font-size:12px;outline:none}",
			".te-choInput:focus-visible{box-shadow:0 0 0 2px var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary))}",
			".te-choSearch{flex:none;height:24px;margin:0;padding:0 9px;border:0;border-radius:6px;",
			"background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-state-business-primary);",
			"font-family:inherit;font-size:11px;font-weight:500;line-height:22px;cursor:pointer;outline:none}",
			".te-choSearch:disabled{color:var(--dsw-alias-label-tertiary);cursor:default}",
			".te-choLvls{display:flex;flex-wrap:wrap;gap:4px;margin-top:8px}",
			".te-lvl{padding:0 8px;height:22px;border:.5px solid var(--dsw-alias-border-l2);border-radius:6px;",
			"background:0 0;color:var(--dsw-alias-label-secondary);",
			"font-family:inherit;font-size:11px;font-weight:500;line-height:20px;cursor:pointer;outline:none;",
			"transition:background .16s ease,color .16s ease,border-color .16s ease}",
			".te-lvl:hover,.te-lvl:focus-visible{background:var(--dsw-alias-interactive-bg-hover);",
			"color:var(--dsw-alias-label-primary)}",
			/* Selected chips: outlined in the accent, not filled — the accent
			   stays a line here so seven pills do not read as a slab. */
			".te-lvlOn{color:var(--dsw-alias-state-business-primary);border-color:var(--dsw-alias-state-business-primary)}",
			".te-lvlOn:hover,.te-lvlOn:focus-visible{color:var(--dsw-alias-state-business-primary)}",
			".te-wires{display:flex;flex-direction:column;gap:4px;margin-top:8px}",
			".te-choAdv{flex:none;margin:0;padding:0;border:0;background:0 0;",
			"color:var(--dsw-alias-label-secondary);",
			"font-family:inherit;font-size:11px;font-weight:500;line-height:16px;cursor:pointer;outline:none;",
			"transition:color .16s ease}",
			".te-choAdv:hover,.te-choAdv:focus-visible{color:var(--dsw-alias-state-business-primary)}",
			".te-wire{display:flex;align-items:center;gap:6px;min-width:0}",
			".te-wireKey{flex:none;min-width:56px;color:var(--dsw-alias-label-secondary);",
			"font-size:11px;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
			".te-wireInput{flex:1;min-width:0;height:22px;margin:0;padding:0 8px;border:0;border-radius:6px;",
			"background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);",
			"font-family:inherit;font-size:12px;outline:none}",
			".te-wireInput:focus-visible{box-shadow:0 0 0 2px var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary))}",
			".te-wireOff{flex:1;min-width:0;color:var(--dsw-alias-label-secondary);font-size:11px;line-height:20px;",
			"overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
			".te-choNote{display:flex;align-items:center;gap:6px;min-width:0;margin-top:8px;",
			"color:var(--dsw-alias-label-secondary);font-size:11px;line-height:16px}",
			".te-choNoteErr{color:var(--dsw-alias-state-error-primary)}",
			".te-choBtns{display:flex;align-items:center;gap:6px;margin-top:9px}",
			".te-btnApply{height:24px;margin:0;padding:0 10px;border:0;border-radius:6px;",
			"background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-state-business-primary);",
			"font-family:inherit;font-size:11px;font-weight:500;line-height:22px;cursor:pointer;outline:none}",
			".te-btnApply:hover,.te-btnApply:focus-visible{background:var(--dsw-alias-interactive-bg-hover);",
			"box-shadow:0 0 0 1px var(--dsw-alias-state-business-primary)}",
			".te-btnApply:disabled{color:var(--dsw-alias-label-tertiary);cursor:default;box-shadow:none}",
			".te-btnGhost{height:24px;margin-left:auto;padding:0 8px;border:0;border-radius:6px;background:0 0;",
			"color:var(--dsw-alias-label-secondary);",
			"font-family:inherit;font-size:11px;font-weight:500;line-height:22px;cursor:pointer;outline:none}",
			".te-btnGhost:hover,.te-btnGhost:focus-visible{background:var(--dsw-alias-interactive-bg-hover)}",

			"@media (prefers-reduced-motion:reduce){.te-cellBlink{animation:none}.te-chip,.te-chipChevron,.te-field,.te-thumb,.te-fill,.te-ghost,.te-ghostFill{transition:none}}"
		].join("");

		/**
		 * Absence test covering BOTH null and undefined.
		 *
		 * A missing field on a model descriptor is `undefined`, not `null`, so a
		 * `value !== null` guard lets an absent `reasoning` through and the next
		 * property read throws — which retires the slot entry from its cell.
		 */
		function absent(value) {
			return value === null || value === void 0;
		}

		/**
		 * Subscribe to one ModelDirectory snapshot store without re-render churn.
		 *
		 * Both hook paths run on EVERY render. The obvious shape — return early
		 * when `useSyncExternalStore` exists, otherwise fall back to `useState` +
		 * `useEffect` — calls a different number of hooks depending on the
		 * environment, which is a latent #310: it happens to be stable per browser,
		 * but it is the same class of bug that blanked this control, so the fallback
		 * hooks are declared unconditionally and simply not driven when the
		 * external store is available.
		 */
		function useStoreSnapshot(store) {
			const usable = !absent(store) && typeof store.subscribe === "function" &&
				typeof store.getSnapshot === "function";
			const external = typeof useSyncExternalStore === "function";
			const subscribe = useCallback(
				(listener) => (usable ? store.subscribe(listener) : () => {}),
				[store, usable]
			);
			const getSnapshot = useCallback(() => (usable ? store.getSnapshot() : null), [store, usable]);

			/* Called unconditionally; `useSyncExternalStore` is always defined on
			   React 18, and the guard only makes the call safe on older versions. */
			const synced = typeof useSyncExternalStore === "function"
				? useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
				: void 0;

			const [value, setValue] = useState(getSnapshot);
			useEffect(() => {
				if (external) return void 0;
				if (!usable) return void 0;
				const sync = () => setValue(store.getSnapshot());
				sync();
				return store.subscribe(sync);
			}, [store, usable, external]);

			return external ? synced : value;
		}

		/**
		 * Resolve the per-Session shared directory, retrying while it is unavailable.
		 *
		 * `directoryFor` throws until the Session has a scope and a binding, which
		 * at boot happens AFTER the composer mounts. This used to run inside a
		 * `useMemo` whose dependencies never change, so that first failure was
		 * cached for the life of the component: the control never appeared on a
		 * fresh start and only came back when the plugin was re-enabled (i.e. when
		 * the component was remounted). A memo cannot retry — so this resolves on
		 * every render through the cache, and a small bounded timer forces the
		 * re-renders that make the retry happen.
		 */
		function useDirectory(models, sessionId, directoryCache) {
			const attemptsRef = useRef(0);
			const [attempt, setAttempt] = useState(0);
			void attempt;

			let directory = null;
			if (!absent(models) && typeof sessionId === "string" && sessionId.length > 0) {
				const cached = directoryCache.get(sessionId);
				if (cached !== void 0) {
					directory = cached;
				} else {
					try {
						const resolved = models.directoryFor(sessionId);
						if (!absent(resolved) && resolved.available !== false) {
							directoryCache.set(sessionId, resolved);
							directory = resolved;
						}
					} catch (error) {
						directory = null;
					}
				}
			}

			useEffect(() => {
				if (directory !== null) {
					attemptsRef.current = 0;
					return void 0;
				}
				/* Stop after a few seconds of trying: a Session that never becomes
				   addressable will not be fixed by waiting forever, and a socket of
				   timers is worse than one honest absence. */
				if (attemptsRef.current >= 40) return void 0;
				attemptsRef.current += 1;
				const timer = setTimeout(() => setAttempt((value) => value + 1), 100);
				return () => clearTimeout(timer);
			}, [directory, sessionId]);

			return directory;
		}

		/**
		 * Read the effort ladder for the current model.
		 *
		 * `declared` comes from the adapter; when it offers fewer than two levels
		 * the Host is telling us the model has no adjustable capability, and the
		 * control falls back to the shared ladder so the level can still be
		 * requested (the Host validates it and rejects an unsupported one).
		 */
		function describeEffort(state) {
			const empty = {
				offered: false, known: false, forced: false, ours: false,
				activeKnown: false, activeOffered: false, activeId: null,
				efforts: [], index: 0, count: 0, display: "", isMax: false,
				provider: null, model: null
			};
			if (absent(state)) return empty;
			const current = state.current;
			if (absent(current)) return empty;

			let entry = null;
			const groups = state.groups;
			if (Array.isArray(groups)) {
				for (let g = 0; g < groups.length; g++) {
					const group = groups[g];
					if (absent(group) || group.id !== current.provider) continue;
					const models = group.models;
					if (!Array.isArray(models)) continue;
					for (let m = 0; m < models.length; m++) {
						const candidate = models[m];
						if (!absent(candidate) && candidate.id === current.model) entry = candidate;
					}
				}
			}

			const reasoning = absent(entry) ? void 0 : entry.reasoning;
			const declaredEfforts = absent(reasoning) ? void 0 : reasoning.efforts;
			const defaultEffort = absent(reasoning) ? void 0 : reasoning.defaultEffort;

			const declared = Array.isArray(declaredEfforts) ? declaredEfforts : [];
			/* Whether the catalogue KNOWS this model. A model that is not in the
			   catalogue yet (the catalogue is still loading, or the model was
			   removed) is not a model without a ladder — it is a model whose
			   ladder is UNKNOWN, and nothing may be concluded from it. */
			const known = entry !== null;
			/* A model with NO ladder at all cannot take an effort: `dsh-llm`
			   refuses every explicit effort before provider I/O. A model with
			   exactly ONE ladder CAN take it, so the threshold is zero — a
			   single declared level is a real, submittable level. */
			const forced = declared.length === 0;
			/* A thin declared ladder falls back to the PREVIEW stops: they are a
			   mirror of the default set, not real efforts. The control may swap
			   in a chooser draft on top of this (`draftIds`), which is why the
			   fallback must stay a plain array the control can replace. */
			const efforts = forced ? PREVIEW_LEVELS : declared;

			/* Whether this is the ladder the Host half manages. The fingerprint is
			   the SHAPE a declaration takes, not one exact set: every id inside
			   the official vocabulary, no per-level description and no default,
			   since `reasoningInfo` in `dsh-llm-pi-ai` synthesizes exactly
			   `{id, name}` for declared ladders and nothing else. This covers any
			   customized set the chooser wrote, and — accepted by design — also
			   a hand-written dict in that same shape, whose removal the Host
			   permits: the shape is the plugin's contract, and the pi-ai schema
			   rejects anything outside it anyway. A wrong guess can only offer a
			   removal the Host then refuses (`planRevert` re-checks before it
			   deletes). */
			let ours = false;
			if (!forced) {
				ours = declared.length > 0 && absent(defaultEffort);
				for (let i = 0; ours && i < declared.length; i++) {
					const level = declared[i];
					if (absent(level) || typeof level.id !== "string" ||
						VOCAB_IDS.indexOf(level.id) < 0 || !absent(level.description)) ours = false;
				}
			}

			/* Match the active level; a forced ladder has no default to inherit. */
			const activeId = absent(current.reasoningEffort) ? defaultEffort : current.reasoningEffort;
			let index = 0;
			/* Whether the level the store holds is one this model actually offers.
			   The two can disagree: a selection made against another model — or
			   against an older, wider ladder — survives in the durable projection
			   and in `agent-default-model`, and the new model does not offer it.
			   `dsh-llm` then refuses every request with
			   UNSUPPORTED_REASONING_EFFORT, and the control must not pretend the
			   level is in force.

			   A FORCED ladder offers nothing at all: its stops are the PREVIEW
			   mirror, and the Host refuses every explicit effort for such a model
			   before provider I/O. So a level that "matches" the preview is NOT
			   offered — treating it as offered is what pinned the control to the
			   top stop and made every press a no-op. */
			let activeOffered = false;
			if (activeId !== void 0 && !forced) {
				for (let i = 0; i < efforts.length; i++) {
					const level = efforts[i];
					if (!absent(level) && level.id === activeId) {
						index = i;
						activeOffered = true;
					}
				}
			} else if (forced) {
				index = 0;
			}
			if (index > efforts.length - 1) index = Math.max(0, efforts.length - 1);

			/* Whether an actual level is in force. A forced ladder with nothing
			   selected yet must not claim the lowest level is active: the provider
			   is still deciding, and saying "Minimal" would be a small lie.

			   A level the model does not offer is not "in force" either — it is a
			   leftover from another model or another ladder. Claiming it would
			   put the name of a level on the trigger that no request can carry,
			   and would paint the control as the top tier. */
			const activeKnown = activeId !== void 0 && activeOffered;
			const level = efforts[index];
			/* The retained name is a HOST fallback for the case where the model
			   declares no ladder at all — but it also carries a level the model
			   does not offer (the store keeps the last name it saw). Naming such
			   a level on the trigger claims a capability the model lacks, so it
			   is only used when no level is actually in force AND the store did
			   not name a level either. */
			const named = absent(current.reasoningEffort) ? void 0 : current.reasoningEffort;
			const display = activeKnown && !absent(level) && typeof level.name === "string" &&
				level.name.length > 0
				? level.name
				: (named === void 0 && typeof state.retainedEffort === "string" ? state.retainedEffort : "");

			return {
				offered: known,
				known,
				forced,
				ours,
				activeKnown,
				activeOffered,
				activeId: named === void 0 ? null : named,
				efforts,
				index,
				count: efforts.length,
				display,
				isMax: activeKnown && efforts.length >= 2 && index === efforts.length - 1,
				provider: current.provider,
				model: current.model
			};
		}

		/** Deterministic scatter: the same layout must survive every re-render. */
		function makeRandom(seed) {
			let value = seed >>> 0;
			return () => {
				value = (value + 0x6D2B79F5) >>> 0;
				let t = Math.imul(value ^ (value >>> 15), 1 | value);
				t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
				return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
			};
		}

		/**
		 * The square lattice shown at the highest tier. Returns the track counts
		 * too: a grid without explicit columns collapses into one row.
		 *
		 * The field must COVER the groove — an earlier version dropped ~14% of the
		 * positions and centred the grid, which left both ends of the rail empty.
		 * Coverage is now structural: every position is filled, and the column
		 * count is rounded to span the full inner width (the stylesheet then
		 * distributes the remainder between the tracks).
		 *
		 * "Ordered but not uniform" therefore comes from brightness and motion
		 * rather than from missing cells:
		 *
		 *   weight    every cell carries its own base opacity, so the field is
		 *             uneven even where nothing is moving;
		 *   motion    35% twinkle, each on its own fast period and a negative
		 *             delay, so they never start together or fall into step.
		 */
		function useFieldCells(railWidth) {
			return useMemo(() => {
				if (railWidth <= 0) return { cols: 0, cells: [] };
				const inner = railWidth - 8;
				const pitch = FIELD_CELL + FIELD_GAP;
				let cols = Math.round((inner + FIELD_GAP) / pitch);
				if (cols < 4) cols = 4;
				const random = makeRandom(0x2f6e2b1);
				const cells = [];
				for (let c = 0; c < cols; c++) {
					for (let r = 0; r < FIELD_ROWS; r++) {
						const weight = 0.30 + random() * 0.70;
						const blink = random() < 0.35;
						const duration = (1.4 + random() * 1.9).toFixed(2) + "s";
						const delay = (-random() * 4).toFixed(2) + "s";
						cells.push({
							key: c + ":" + r,
							blink,
							duration,
							delay,
							weight: weight.toFixed(2)
						});
					}
				}
				return { cols, cells };
			}, [railWidth]);
		}

		function format(template, values) {
			let out = template;
			const keys = Object.keys(values);
			for (let i = 0; i < keys.length; i++) {
				out = out.split("{" + keys[i] + "}").join(String(values[keys[i]]));
			}
			return out;
		}

		/**
		 * The declare/remove conversation with the Host half, for the state
		 * where a level cannot be chosen (or the ladder itself must be managed).
		 *
		 * `state` is the Host's own verdict, never a guess:
		 *   undeclared    the field is absent — `declare` can add it
		 *   ours          a declaration the Host manages — `revert` can undo it,
		 *                 customized sets included
		 *   native        somebody else's declaration — report only
		 *   nonreasoning  declared as not supporting thinking — report only
		 *   unsupported   no route, no model, or no configuration editor
		 *   checking      the read is in flight
		 *
		 * The read happens while the rail is hosted in the menu and the model's
		 * ladder needs the Host's verdict — either because it is too thin to
		 * choose from, or because the ladder itself is the plugin's own and can
		 * be undone. The second case used to be missed: the read required a
		 * THIN ladder, while the removal action appears only on a ladder the
		 * plugin declared, so the two conditions could never hold at once and
		 * the removal button never knew what the Host thought of it.
		 */
		function useDeclare(visible, info, reload) {
			const [state, setState] = useState("checking");
			const [code, setCode] = useState("");
			const [busy, setBusy] = useState(false);
			/* A write changes the ladder this exact read describes, so every
			   settled write bumps a nonce to re-run it: the old code left the
			   verdict stale (believed "ours" after a revert on a single-level
			   ladder, redeclared "undeclared" only by luck of a component
			   remount). A re-read is also more honest than the local guess. */
			const [nonce, setNonce] = useState(0);
			/* The levels the Host says the request path accepts, or null when the
			   Host could not read them. Null is NOT an empty list: an empty list
			   means the model really takes no effort. */
			const [levels, setLevels] = useState(null);
			/* The Host owns the verdict, and it is asked whenever the panel is up
			   and the model is KNOWN — not only when the ladder is thin. The
			   catalogue the rail draws from can be stale (the shared catalogue
			   short-circuits on an already-loaded value), so the Host's answer is
			   the only trustworthy one about what is declared and what the
			   request path will accept. */
			const active = visible && info.known;
			const refresh = useCallback(
				() => (typeof reload === "function" ? reload() : Promise.resolve()),
				[reload]
			);

			useEffect(() => {
				if (!active) return void 0;
				if (typeof fetch !== "function") {
					setState("unsupported");
					return void 0;
				}
				let live = true;
				setState("checking");
				setCode("");
				const query = DECLARE_ROUTE + "?provider=" + encodeURIComponent(info.provider) +
					"&model=" + encodeURIComponent(info.model);
				fetch(query, { headers: { accept: "application/json" } })
					.then((response) => (response.ok ? response.json() : Promise.reject(new Error("HTTP " + String(response.status)))))
					.then((payload) => {
						if (!live) return;
						if (absent(payload) || typeof payload.state !== "string") {
							setState("unsupported");
							return;
						}
						setState(payload.state);
						/* The Host also reports the levels the REQUEST path will
						   actually accept. `null` means "could not be read" and
						   is NOT an empty list — nothing may be concluded from
						   it. An empty list means the model really takes no
						   effort, which is what makes a stored level stranded. */
						if (Array.isArray(payload.levels)) {
							setLevels(payload.levels.filter((id) => typeof id === "string"));
						} else {
							setLevels(null);
						}
					})
					.catch(() => {
						if (live) setState("unsupported");
					});
				return () => {
					live = false;
				};
			}, [active, info.provider, info.model, nonce]);

			/**
			 * Send one write, always resolving a plain verdict: `{ ok, code }`.
			 * The chooser needs the outcome inline (it reports a refusal in
			 * place); the old void-shaped callers ignore the value, which keeps
			 * the two styles compatible.
			 */
			const apply = useCallback((action, levels) => {
				if (typeof fetch !== "function") return Promise.resolve({ ok: false, code: "no-fetch" });
				/* The chooser's input drives the body, so it is marshalled BEFORE
				   any state update: a level map is not storable in a hook's
				   dependency list, and the body must match what the caller saw. */
				const body = { provider: info.provider, model: info.model, action };
				if (action === "declare") body.levels = levels;
				return new Promise((resolve) => {
					let done = false;
					const finish = (value) => {
						if (done) return;
						done = true;
						resolve(value);
					};
					setBusy(true);
					setCode("");
					fetch(DECLARE_ROUTE, {
						method: "POST",
						headers: { "content-type": "application/json", accept: "application/json" },
						body: JSON.stringify(body)
					})
						.then((response) => response.json().then(
							(payload) => ({ ok: response.ok, payload }),
							() => ({ ok: false, payload: null })
						))
						.then((outcome) => {
							if (!outcome.ok || absent(outcome.payload) || outcome.payload.ok !== true) {
								const why = !absent(outcome.payload) && typeof outcome.payload.code === "string"
									? outcome.payload.code : "write-failed";
								setBusy(false);
								setCode(why);
								finish({ ok: false, code: why });
								return;
							}
							/* The write landed, but the ladder the REQUEST path validates
							   is not live yet: the profile reload, the adapter rebuild and
							   the catalog refetch all happen after the write returns.
							   Submitting a level inside that window is exactly what
							   produced "this provider does not support that level" with no
							   user-visible cause, so stay busy until the directory has
							   actually caught up.

							   `reload` is the CATALOGUE reload, and it cannot be trusted
							   to reflect the write: the shared catalogue short-circuits on
							   an already-loaded value, so it may answer with the very
							   ladder that was just removed. The re-read this triggers
							   (`nonce`) asks the HOST instead, and the Host is the
							   authority on what is declared. */
							const next = action === "declare" ? "ours" : "undeclared";
							const settle = () => {
								setBusy(false);
								setState(next);
								setNonce((value) => value + 1);
								finish({ ok: true, code: "" });
							};
							refresh().then(settle, settle);
						})
						.catch(() => {
							setBusy(false);
							setCode("write-failed");
							finish({ ok: false, code: "write-failed" });
						});
				});
			}, [info.provider, info.model, refresh]);

			return {
				state: active ? state : "idle",
				code,
				busy,
				levels,
				apply
			};
		}

		/**
		 * The ladder ids a models.dev match SUGGESTS: its effort values ∩ this
		 * plugin's vocabulary (never auto-enabling off), in ladder order. Two
		 * levels are the minimum for a usable rail; anything leaner — or an
		 * unparseable match — returns null and the caller falls back to the
		 * standard ladder. This is the shared read of "what does models.dev
		 * say this model offers": the one-click enable and the chooser's
		 * prefill agree on it by construction.
		 */
		function matchLadderIds(match) {
			if (absent(match) || typeof match !== "object") return null;
			const values = [];
			for (const option of Array.isArray(match.options) ? match.options : []) {
				if (option.type === "effort" && Array.isArray(option.values)) {
					for (const value of option.values) values.push(String(value));
				}
			}
			if (values.length === 0 && Array.isArray(match.efforts)) {
				for (const value of match.efforts) values.push(String(value));
			}
			const ids = [];
			for (const id of VOCAB_IDS) {
				if (id === "off" || values.indexOf(id) < 0) continue;
				ids.push(id);
			}
			return ids.length >= 2 ? ids : null;
		}

		/**
		 * The widest ladder the catalogue offers for one model.
		 *
		 * The same model is listed by dozens of providers and they do not agree
		 * on how many levels it has: `gpt-6.1-sol` is published with five
		 * (low, medium, high, xhigh, max) by most of them and with three by a
		 * few. Taking the FIRST match made the suggestion a coin flip, and the
		 * one-click enable then wrote three stops where the upstream offers
		 * five. The widest ladder wins; a tie keeps the Host's own order.
		 *
		 * @param {object[]} matches - the catalogue rows, best first.
		 * @returns {object|null} the row with the most selectable levels.
		 */
		function widestMatch(matches) {
			if (!Array.isArray(matches) || matches.length === 0) return null;
			let best = null;
			let bestIds = null;
			for (const match of matches) {
				const ids = matchLadderIds(match);
				if (ids === null) continue;
				if (bestIds === null || ids.length > bestIds.length) {
					best = match;
					bestIds = ids;
				}
			}
			return best;
		}

		/**
		 * The level picker: the CUSTOM detour, opened only from the footer's
		 * "自定义…" link. The one-click enable in the footer does the ordinary
		 * job — suggest the catalogue ladder (or the standard one) and write
		 * it — so this panel is for the human who wants a different set, and
		 * it therefore hides its expert machinery by default:
		 *
		 *   - the visible question is only "which levels": one row of chips;
		 *   - per-level wire spellings hide behind the "自定义发送值…" toggle;
		 *   - the catalogue search row only appears when the automatic query
		 *     did NOT answer (nothing matched, or fetch unavailable) — a
		 *     successful suggestion reduces to one note line, not a form.
		 *
		 * It is a component of its own (its hooks live under its own mount, so
		 * opening and closing it never reorders the panel's hooks), driven by
		 * props only:
		 *
		 *   info      the live model, for the query fallback and the route keys
		 *   declare   the write handle (apply/cell for busy)
		 *   onDraft   the pipe that lifts the current selection into the panel,
		 *             so the idle preview above it mirrors what would be
		 *             declared before anything is written
		 *   onClose   dismisses the chooser (and clears the draft for it)
		 *
		 * A models.dev query pre-fills the selection: the catalog id answers by
		 * bare name (the model id's last "/"), the picker ranks matches, and
		 * the first one's effort values ∩ the plugin's vocabulary become the
		 * selected chips with their wire spellings pre-filled. The query does
		 * not write anything — it only suggests.
		 */
		function DeclareChooser({ t, declare, info, onDraft, onClose }) {
			const bareName = typeof info.model === "string" && info.model.length > 0
				? (info.model.indexOf("/") < 0 ? info.model : info.model.slice(info.model.lastIndexOf("/") + 1))
				: "";
			const [selected, setSelected] = useState(null);
			const [wires, setWires] = useState({});
			const [query, setQuery] = useState(bareName);
			const [lookup, setLookup] = useState({ state: "querying", matches: [], index: -1 });
			const [adv, setAdv] = useState(false);
			const [why, setWhy] = useState("");
			const startedRef = useRef(false);

			/* Lift the draft upward every time the selection changes, so the idle
			   rail behind the chooser previews the thing being declared. The
			   joined ids are the dependency: a fresh array per render is not a
			   change unless the MEMBERSHIP changed. */
			const selectedIds = selected === null ? DEFAULT_PREVIEW_IDS.slice() : VOCAB_IDS.filter((id) => selected[id] === true);
			const selectionKey = selectedIds.join(",");
			useEffect(() => {
				onDraft(selected === null ? null : selectedIds.slice());
			}, [selectionKey]);

			/* A catalogue match pre-fills what it can: the effort values it
			   publishes ∩ this plugin's vocabulary become selected chips, and
			   their wire spelling defaults to the value models.dev publishes —
			   which is exactly the spelling a real gateway accepts for that
			   model. Values like `none`/`thinking` that are not official ids are
			   skipped; the wire rows remain the right place for those. */
			const prefill = (match, indexAllMatches) => {
				setLookup({ state: "matched", matches: indexAllMatches, index: indexAllMatches.indexOf(match) });
				const next = {};
				for (const id of VOCAB_IDS) next[id] = false;
				next.off = false;
				const options = [];
				for (const option of Array.isArray(match.options) ? match.options : []) {
					if (option.type === "effort" && Array.isArray(option.values)) {
						for (const value of option.values) options.push(String(value));
					}
				}
				const effort = options.length > 0 ? options : (Array.isArray(match.efforts) ? match.efforts.map(String) : []);
				const nextWires = {};
				for (const id of VOCAB_IDS) nextWires[id] = id;
				for (const value of effort) {
					if (VOCAB_IDS.indexOf(value) < 0) continue;
					next[value] = true;
					nextWires[value] = value;
				}
				setSelected(next);
				setWires(nextWires);
			};

			const run = useCallback((rawName) => {
				const name = rawName.trim();
				if (typeof fetch !== "function") return;
				if (name.length === 0) {
					setLookup({ state: "empty", matches: [], index: -1 });
					return;
				}
				setLookup({ state: "querying", matches: [], index: -1 });
				fetch(MODELSDEV_ROUTE + "?name=" + encodeURIComponent(name), { headers: { accept: "application/json" } })
					.then((response) => (response.ok ? response.json() : Promise.reject(new Error("HTTP " + String(response.status)))))
					.then((payload) => {
						if (absent(payload) || payload.ok !== true || !Array.isArray(payload.matches)) {
							throw new Error("bad payload");
						}
						if (payload.matches.length === 0) {
							setLookup({ state: "none", matches: [], index: -1 });
							return;
						}
						prefill(widestMatch(payload.matches) ?? payload.matches[0], payload.matches);
					})
					.catch(() => {
						setLookup({ state: "failed", matches: [], index: -1 });
					});
			}, []);

			/* Query once per open, from the panel's own environment: fetch may
			   be missing (a route-less host), in which case the whole point —
			   fine anyway, the chooser's chips are fully manual. */
			useEffect(() => {
				if (startedRef.current) return void 0;
				startedRef.current = true;
				if (typeof fetch !== "function") {
					setLookup({ state: "no-fetch", matches: [], index: -1 });
					return void 0;
				}
				run(bareName);
				return void 0;
			}, []);

			const wireFor = (id) => {
				const value = wires[id];
				return typeof value === "string" ? value : id;
			};

			const submit = () => {
				if (selectedIds.length === 0) {
					setWhy(t("cho.none"));
					return;
				}
				const levels = {};
				for (const id of VOCAB_IDS) {
					if (selected[id] !== true) continue;
					if (id === "off") {
						levels.off = null;
						continue;
					}
					const spelling = wireFor(id).trim();
					if (spelling.length === 0) {
						setWhy(t("cho.wireEmpty"));
						return;
					}
					levels[id] = spelling;
				}
				setWhy("");
				declare.apply("declare", levels).then((result) => {
					if (absent(result) || result.ok !== true) {
						const code = !absent(result) && typeof result.code === "string" && result.code.length > 0
							? result.code : "write-failed";
						setWhy(t("why." + code));
						return;
					}
					onClose();
				});
			};

			const match = lookup.index >= 0 && lookup.index < lookup.matches.length ? lookup.matches[lookup.index] : null;
			let note = null;
			let noteError = false;
			if (why !== "") {
				note = why;
				noteError = true;
			} else if (lookup.state === "querying") {
				note = t("cho.checking");
			} else if (lookup.state === "failed") {
				note = t("why.fetch-failed") + "。";
				noteError = true;
			} else if (lookup.state === "none" || lookup.state === "empty") {
				note = t("cho.noMatch");
			} else if (lookup.state === "no-fetch") {
				note = t("why.no-fetch");
			} else if (match !== null) {
				const values = [];
				for (const option of Array.isArray(match.options) ? match.options : []) {
					if (option.type === "effort" && Array.isArray(option.values)) values.push(option.values.join("/"));
				}
				note = values.length > 0
					? match.id + " · " + format(t("cho.offers"), { values: values.join(" · ") })
					: match.id;
			}

			/* The search form answers a FAILED lookup, not a routine one: a
			   matched name reduces to the note line below, an unmatched or
			   erroring one opens the one row that can fix it. Without fetch
			   there is no catalogue to query, so even a failed state keeps the
			   panel at the chips alone. */
			const searching = lookup.state === "none" || lookup.state === "empty" ||
				lookup.state === "failed";
			const rows = searching ? h(
				"div",
				{ className: "te-choRow" },
				h("span", { className: "te-choLbl" }, t("cho.source")),
				h("input", {
					type: "text",
					className: "te-choInput",
					value: query,
					onChange: (event) => setQuery(event.target.value),
					onKeyDown: (event) => {
						if (event.key === "Enter" && !declare.busy) run(query);
					},
					"aria-label": t("cho.source")
				}),
				h("button", {
					type: "button",
					className: "te-choSearch",
					disabled: declare.busy || lookup.state === "querying",
					onClick: () => run(query)
				}, t("cho.search"))
			) : null;

			const matchPick = lookup.state === "matched" && lookup.matches.length > 1 ? h(
				"div",
				{ className: "te-choRow" },
				h("span", { className: "te-choLbl" }, t("cho.matchCount")),
				h("select", {
					className: "te-choInput",
					value: String(lookup.index),
					onChange: (event) => {
						const index = Number(event.target.value);
						if (index >= 0 && index < lookup.matches.length) prefill(lookup.matches[index], lookup.matches);
					}
				}, lookup.matches.map((entry, index) => h("option", {
					key: entry.provider + "/" + entry.id,
					value: String(index)
				}, entry.provider + " / " + entry.id + (entry.name.length > 0 && entry.name !== entry.id ? " — " + entry.name : ""))))
			) : null;

			const chips = h(
				"div",
				{ className: "te-choLvls" },
				VOCAB_LEVELS.map((level) => h("button", {
					type: "button",
					key: level.id,
					className: selected !== null && selected[level.id] === true ? "te-lvl te-lvlOn" : "te-lvl",
					"aria-pressed": selected !== null && selected[level.id] === true,
					onClick: () => {
						setSelected((current) => {
							const next = {};
							for (const id of VOCAB_IDS) next[id] = current !== null && current[id] === true;
							next[level.id] = !next[level.id];
							return next;
						});
					}
				}, level.name))
			);

			const wireRows = h(
				"div",
				{ className: "te-wires" },
				h("div", { className: "te-choRow" }, h("span", { className: "te-choLbl" }, t("cho.wires"))),
				VOCAB_IDS.filter((id) => selected !== null && selected[id] === true).map((id) => id === "off"
					? h("div", { className: "te-wire", key: id }, h("span", { className: "te-wireKey" }, "Off"),
						h("span", { className: "te-wireOff" }, t("cho.offHint")))
					: h("div", { className: "te-wire", key: id },
						h("span", { className: "te-wireKey" }, VOCAB_LEVELS.find((level) => level.id === id)?.name ?? id),
						h("input", {
							type: "text",
							className: "te-wireInput",
							value: wireFor(id),
							placeholder: t("cho.wirePlaceholder"),
							onChange: (event) => {
								const value = event.target.value;
								setWires((current) => ({ ...current, [id]: value }));
							}
						})))
			);

			/* The expert detour: the toggle always offerable, the rows only
			   once it is flipped. `wireFor` still fills untouched spellings
			   with the level id, so a closed detour writes a perfectly valid
			   ladder. */
			const advToggle = h(
				"button",
				{
					type: "button",
					className: "te-choAdv",
					"aria-expanded": adv,
					onClick: () => setAdv(!adv)
				},
				t("cho.adv")
			);

			return h(
				"div",
				{ className: "te-cho", "data-te-chooser": "" },
				rows,
				matchPick,
				chips,
				advToggle,
				adv ? wireRows : null,
				note === null ? null : h(
					"div",
					{ className: noteError ? "te-choNote te-choNoteErr" : "te-choNote" },
					note
				),
				h(
					"div",
					{ className: "te-choBtns" },
					h("button", {
						type: "button",
						className: "te-btnApply",
						disabled: declare.busy,
						onClick: submit
					}, declare.busy ? t("act.pending") : format(t("cho.apply"), { count: selectedIds.length })),
					h("button", {
						type: "button",
						className: "te-btnGhost",
						disabled: declare.busy,
						onClick: onClose
					}, t("cho.cancel"))
				)
			);
		}

		/* ------------------------------------------------------------------ *
		 * The control.
		 *
		 * Trigger and panel are ONE component, registered in
		 * `conversation.input.right` so it sits immediately LEFT of the shipped
		 * model seat. The composer row is inside a scroll container, so the panel
		 * is positioned `fixed` from the trigger's own rect.
		 *
		 * This plugin OWNS the effort control: the shipped model menu's own effort
		 * row and the level suffix on its trigger are removed by
		 * `hideShippedEffort` below, so there is exactly one place to change the
		 * level.
		 * ------------------------------------------------------------------ */
		function makeControl(models, directoryCache) {
			return function ThinkingEffort(props) {
				const sessionId = props.sessionId;
				const t = props.t;
				const directory = useDirectory(models, sessionId, directoryCache);
				const state = useStoreSnapshot(absent(directory) ? null : directory.store);
				const info = describeEffort(state);

				const chipRef = useRef(null);
				const railRef = useRef(null);
				const thumbRef = useRef(null);
				const fillRef = useRef(null);
				const fieldRef = useRef(null);
				/* Whether the last park left the hall lit (the top stop) and whether
				   a paint of the running drag has dipped below the top stop — the
				   reveal only plays when the hall genuinely arrives fresh from the
				   dark instead of re-rolling one that was already lit. */
				const fieldLitRef = useRef(false);
				const fieldDippedRef = useRef(false);
				const visualRef = useRef(0);
				const draggingRef = useRef(false);
				const gestureRef = useRef(null);
				const chosenRef = useRef(null);
				const focusedRef = useRef(false);
				const ghostRef = useRef(null);
				const ghostFillRef = useRef(null);

				const [open, setOpen] = useState(false);
				const [anchor, setAnchor] = useState(null);
				const [railWidth, setRailWidth] = useState(0);
				const [dragging, setDragging] = useState(false);
				const [chosen, setChosen] = useState(null);
				/* The level this control ASKED for, by ID, and the generation of
				   that request.

				   The index is useless for this: the ladder can change under a
				   pending request (a model switch, a new declaration), so the
				   same index can name a different level before the request
				   settles. The ID is what the Host stores, so it is what the
				   answer can be compared against.

				   The generation is what makes a late answer harmless: an older
				   request settling after a newer one must not clear the newer
				   request's optimistic position. */
				const [pending, setPending] = useState(null);
				const generationRef = useRef(0);
				const pendingRef = useRef(null);
				/* Bumped by a mid-drag cancel: the dragging flip alone may not move
				   any park dependency (a cancel before the first optimistic push
				   changed nothing), and a cancelled key must re-park on the store's
				   level, not stay where the pointer died. */
				const [cancelEpoch, setCancelEpoch] = useState(0);
				/* Refresh the shared catalog after a write. `load()` is the directory's
				   own reload; it throws for an addressed subagent session, which is
				   exactly why the failure is tolerated rather than propagated. */
				const reload = useCallback(() => {
					if (absent(directory) || typeof directory.load !== "function") return Promise.resolve();
					try {
						return Promise.resolve(directory.load()).catch(() => void 0);
					} catch (error) {
						return Promise.resolve();
					}
				}, [directory]);
				const declare = useDeclare(open, info, reload);

				/* ---- a level the model cannot take ----
				   A selection outlives the ladder it was made against: it lives in
				   the durable session projection AND in `agent-default-model`,
				   which `session/selectModel` writes on every successful choice.
				   So a level chosen on one model stays behind after the model
				   changes, and the Host accepts the selection even when the model
				   declares no ladder at all.

				   The control must not sit on such a level: it is not a level the
				   model offers, the thumb parks on the top stop (which reads as
				   "locked at max"), and every press on it is swallowed as "the
				   level is already selected".

				   It is NOT repaired automatically. A repair here would rewrite
				   the user's GLOBAL default as a side effect of merely opening
				   the composer — and the store's `current` can be a perfectly
				   valid level of a model the catalogue has not loaded yet, so the
				   "repair" would drop a working level. The stranded level is
				   therefore REPORTED, with one explicit action, and the user
				   decides. The action selects the same model WITHOUT an effort,
				   which is the only selection the Host accepts for a model
				   without a ladder — and it clears the global default too,
				   because the Host saves that same selection as the default. */
				const strandedRef = useRef("");
				const [resetting, setResetting] = useState(false);
				useEffect(() => {
					if (!info.known || !info.offered) {
						strandedRef.current = "";
						return void 0;
					}
					/* The model offers this level: nothing is stranded. */
					if (info.activeOffered) {
						strandedRef.current = "";
						return void 0;
					}
					const named = info.activeId;
					if (named === null) {
						strandedRef.current = "";
						return void 0;
					}
					strandedRef.current = String(info.provider) + "/" + String(info.model) + "/" + String(named);
				}, [info.known, info.offered, info.activeOffered, info.activeId, info.provider, info.model]);

				/* ---- the projection confirms the level ----
				   The optimistic position is released when the STORE names the
				   level that was asked for. That is the moment the change is
				   durable, and it is a round trip later than the RPC answer — so
				   the key must stay where the user put it until then, or it
				   snaps back to the previous level and the press reads as a
				   no-op.

				   The comparison is by ID, not by index: the ladder can change
				   under a pending request, and the same index can name a
				   different level by the time the answer arrives. */
				useEffect(() => {
					const request = pendingRef.current;
					if (request === null) return void 0;
					if (info.activeId !== request.levelId) return void 0;
					pendingRef.current = null;
					setPending(null);
					chosenRef.current = null;
					setChosen(null);
				}, [info.activeId, info.activeOffered, info.provider, info.model]);

				/* ---- the chooser's state lives here, NOT inside the panel ----
				   The chips draft is lifted into the control so the idle rail can
				   preview the ladder being declared, and both states reset with
				   the panel. Keeping them at this level also means opening or
				   closing the chooser never reorders THIS component's hooks. */
				const [chooser, setChooser] = useState(false);
				const [draftIds, setDraftIds] = useState(null);

				/* ---- the one-click enable ----
				   The default human path for a model without levels: ONE press
				   asks the catalogue for the bare name, enables the levels it
				   suggests (or the standard ladder when nothing answers) and
				   writes. No form, no confirm — the written ladder is visible
				   on the rail the moment it lands, and both "自定义…" and
				   "撤销启用" walk it back. The catalogue step is best-effort:
				   a missing entry, a failing network or no fetch at all still
				   enable the standard ladder, because "no levels at all" is
				   strictly worse than "the standard levels". A refusal surfaces
				   through `declare.code` in the footer's own error line; this
				   closure deliberately holds no second copy of that state. */
				const oneClickEnable = () => {
					const bare = typeof info.model === "string" && info.model.length > 0
						? info.model.slice(info.model.lastIndexOf("/") + 1)
						: "";
					const write = (ids) => {
						const levels = {};
						for (const id of ids) {
							if (id === "off") {
								levels.off = null;
								continue;
							}
							levels[id] = id;
						}
						declare.apply("declare", levels);
					};
					if (typeof fetch !== "function") {
						write(DEFAULT_PREVIEW_IDS.slice());
						return;
					}
					fetch(MODELSDEV_ROUTE + "?name=" + encodeURIComponent(bare), { headers: { accept: "application/json" } })
						.then((response) => response.ok ? response.json() : Promise.reject(new Error("HTTP " + String(response.status))))
						.then((payload) => {
							const matches = !absent(payload) && payload.ok === true && Array.isArray(payload.matches)
								? payload.matches : [];
							const ids = matchLadderIds(widestMatch(matches));
							write(ids !== null ? ids : DEFAULT_PREVIEW_IDS.slice());
						})
						.catch(() => write(DEFAULT_PREVIEW_IDS.slice()));
				};

				/* ---- the Host's answer about the ladder ----
				   The catalogue the rail draws from can be stale — the shared
				   catalogue short-circuits on an already-loaded value — so the
				   Host's own list of accepted levels is the authority on what
				   this model takes. `null` means "could not be read" and is not
				   an empty list, so nothing is concluded from it then.

				   A level that NEITHER the catalogue nor the Host offers is
				   stranded: the session projection still names it, the request
				   path would refuse it, and the rail would sit on a level that
				   cannot be used. */
				const hostLevels = declare.levels;
				const hostOffers = (id) => hostLevels === null || hostLevels.indexOf(id) >= 0;
				/* The catalogue's PREVIEW stops are a mirror of the default set,
				   not levels the model takes — a forced ladder offers nothing. So
				   a catalogue offer counts only when the model really declared
				   that level. */
				const catalogOffers = (id) => !info.forced && info.efforts.some((level) =>
					!absent(level) && level.id === id);
				const strandedId = !info.activeOffered && info.activeId !== null &&
					!catalogOffers(info.activeId) && !hostOffers(info.activeId)
					? info.activeId
					: null;

				/* An idle rail is the "no declared ladder" state: the stops are a
				   preview, not a choice, because the Host refuses any explicit
				   effort for such a model before provider I/O. While the chooser
				   is open the preview is the DRAFT — the ladder being declared,
				   not the fixed default mirror. */
				const idle = info.offered && info.forced;
				const previewEfforts = draftIds === null
					? PREVIEW_LEVELS
					: VOCAB_LEVELS.filter((level) => draftIds.indexOf(level.id) >= 0);
				const shownEfforts = idle ? previewEfforts : info.efforts;
				const count = shownEfforts.length;
				const travel = Math.max(0, railWidth - THUMB_W);
				const index = !absent(chosen) && chosen <= count - 1 ? chosen : info.index;
				const fraction = count > 1 ? index / (count - 1) : 0;
				const isMax = !idle && info.offered && count >= 2 && index === count - 1;
				const busy = !absent(state) && state.status === "selecting";
				const failed = !absent(state) && typeof state.error === "string" && state.error.length > 0;
				/* The lattice mounts with the live rail (not only at the top stop):
				   its visibility is governed by the clip line at the thumb, so a
				   drag away from Max can retract it column by column instead of
				   dropping the whole slab at once. An idle rail has no thumb and
				   therefore no line — nothing mounts to leak into the preview. */
				const field = useFieldCells(open && !idle ? railWidth : 0);

				/* A declaration may narrow the rail to a SINGLE level: a draft the
				   user is still editing, or a real one-level ladder. Both must draw
				   — which is why the old hard `count >= 2` refuses only when there
				   is neither a draft nor a real ladder to show.

				   A real single-level ladder is drawable: the model takes that
				   level, and hiding the control would hide the only thing the
				   user can change about it. */
				const supported = info.offered && (draftIds !== null || count >= 1);

				/* A chooser the panel outran: if the write succeeded before the
				   user closed it, the ladder is real now and the preview belongs
				   to the Host, not the draft. */
				const chooserOpen = idle && chooser;

				/* Closing the chooser discards its draft; so does switching the
				   panel to a ladder the Host already serves. */
				useEffect(() => {
					if (!chooser) setDraftIds(null);
				}, [chooser]);

				/* A model switch invalidates the whole draft: its chips and wire
				   spellings describe the OLD model's ladder. */
				useEffect(() => {
					setChooser(false);
					setDraftIds(null);
				}, [info.provider, info.model]);

				/* ---- take the level control away from the shipped model menu ----
				   The model seat prints "· High/Max" after the model name (hidden in
				   CSS) and its menu carries a "推理等级" row that drills into a level
				   list. Both would be a second, competing way to set the same thing,
				   so the row is hidden too.

				   CRITICAL: the row is HIDDEN, never removed. An earlier version
				   called `button.remove()` on it, and that is a React-owned node:
				   the library's fiber tree still referenced it, so the next
				   reconciliation threw inside `ModelSelect` and the whole model list
				   vanished as soon as a selection triggered a re-render. Collapsing
				   the box keeps the node, its `ref` and every sibling index intact —
				   which also keeps the menu's arrow-key navigation consistent.
				   It is collapsed rather than `display:none` so it stays focusable:
				   a hidden-but-removed-from-tab-order row would trap the Down arrow.

				   The row is matched by its localized label — the shipped classes are
				   hashed and change between builds, the label does not. */
				useEffect(() => {
					/* Every capability is checked, not just the object's presence: a
					   non-browser host may expose a partial `document`, and this effect
					   runs on the very first render — a throw here would retire the
					   slot entry and blank the control entirely. */
					if (typeof document === "undefined") return void 0;
					if (typeof document.querySelectorAll !== "function") return void 0;
					const body = document.body;
					const canObserve = typeof MutationObserver === "function" &&
						body !== null && body !== void 0;

					const collapse = (row) => {
						const style = row.style;
						if (absent(style) || style.height === "0px") return;
						style.height = "0";
						style.minHeight = "0";
						style.paddingTop = "0";
						style.paddingBottom = "0";
						style.marginTop = "0";
						style.marginBottom = "0";
						style.border = "0";
						style.overflow = "hidden";
						style.opacity = "0";
						row.setAttribute("data-te-collapsed", "");
					};

					const hideRow = () => {
						const rows = document.querySelectorAll('button[role="menuitem"]');
						for (const row of rows) {
							if (row.getAttribute("data-te-collapsed") !== null) continue;
							const first = row.firstElementChild;
							const text = absent(first) ? "" : String(first.textContent ?? "").trim();
							if (MENU_EFFORT_LABELS.indexOf(text) < 0) continue;
							collapse(row);
						}
					};

					hideRow();
					if (!canObserve) return void 0;
					/* `attributes` is deliberately NOT observed: collapsing a row
					   writes to its `style`, and watching attributes would re-enter
					   this callback on its own write. */
					const observer = new MutationObserver(hideRow);
					observer.observe(body, { childList: true, subtree: true });
					return () => observer.disconnect();
				}, []);

				/* ---- keep the panel glued to the trigger ---- */
				useLayoutEffect(() => {
					if (!open || !supported) {
						focusedRef.current = false;
						setAnchor(null);
						setChooser(false);
						setDraftIds(null);
						return void 0;
					}
					const chip = chipRef.current;
					if (absent(chip)) return void 0;
					const place = () => {
						const rect = chip.getBoundingClientRect();
						const viewportW = typeof window === "undefined" ? 0 : window.innerWidth;
						const viewportH = typeof window === "undefined" ? 0 : window.innerHeight;
						if (viewportW === 0 || viewportH === 0) return;
						let left = rect.left;
						const maxLeft = viewportW - PANEL_W - 8;
						if (left > maxLeft) left = Math.max(8, maxLeft);
						if (left < 8) left = 8;
						setAnchor({
							left,
							bottom: Math.max(8, viewportH - rect.top + GAP_ABOVE_CHIP)
						});
					};
					place();
					window.addEventListener("resize", place);
					window.addEventListener("scroll", place, true);
					return () => {
						window.removeEventListener("resize", place);
						window.removeEventListener("scroll", place, true);
					};
				}, [open, supported]);

				/* ---- measure the rail while the panel is up, and seat the focus ---- */
				useLayoutEffect(() => {
					if (!open || !supported || absent(anchor)) return void 0;
					const rail = railRef.current;
					if (absent(rail)) return void 0;
					const measure = () => setRailWidth(rail.clientWidth);
					measure();
					/* Land keyboard focus on the slider so arrow keys work at once.
					   Once per open: re-focusing on every reshape would fight the
					   pointer and steal focus while the user types. An idle rail
					   has no thumb and nothing to move, so it takes no focus. */
					if (!focusedRef.current && !idle) {
						const thumb = thumbRef.current;
						if (!absent(thumb) && typeof thumb.focus === "function") {
							focusedRef.current = true;
							thumb.focus();
						}
					}
					if (typeof ResizeObserver === "function") {
						const observer = new ResizeObserver(measure);
						observer.observe(rail);
						return () => observer.disconnect();
					}
					return void 0;
				}, [open, supported, anchor, idle]);

				/* ---- dismiss on outside press ---- */
				useEffect(() => {
					if (!open) return void 0;
					if (typeof document === "undefined") return void 0;
					const onPress = (event) => {
						const target = event.target;
						if (!absent(target) && typeof target.closest === "function") {
							if (target.closest("[data-te-panel]") !== null) return;
							if (target.closest("[data-te-chip]") !== null) return;
						}
						setOpen(false);
					};
					document.addEventListener("mousedown", onPress);
					return () => document.removeEventListener("mousedown", onPress);
				}, [open]);

				/* ---- Escape closes from anywhere, not only from the slider ---- */
				useEffect(() => {
					if (!open) return void 0;
					if (typeof document === "undefined") return void 0;
					const onKey = (event) => {
						if (event.key !== "Escape") return;
						setOpen(false);
						const chip = chipRef.current;
						if (!absent(chip) && typeof chip.focus === "function") chip.focus();
					};
					document.addEventListener("keydown", onKey);
					return () => document.removeEventListener("keydown", onKey);
				}, [open]);

				/* ---- the lattice lamp: ramp helpers ----
				   `latticeGlow` is how lit the hall is for a rail fraction. It
				   stays zero up to the second-highest stop, rises to one across
				   the zone between the top two stops, and ends at one only at
				   the maximum — with a smoothstep so both ends of the ramp are
				   gentle instead of a hard key. This is what makes crossing the
				   boundary a dissolve rather than a toggle, in either
				   direction, whether the pointer paints it raw or a settle
				   transitions through it. */
				const zoneStart = count >= 2 ? (count - 2) / (count - 1) : 1;
				const latticeGlow = (value) => {
					if (travel <= 0 || count < 2) return value >= 1 ? 1 : 0;
					const span = 1 - zoneStart;
					if (span <= 0) return value >= 1 ? 1 : 0;
					const t = (value - zoneStart) / span;
					const c = t < 0 ? 0 : t > 1 ? 1 : t;
					return c * c * (3 - 2 * c);
				};
				const writeVar = (element, name, value) => {
					try {
						element.style.setProperty(name, value);
					} catch (error) {
						/* The micro-runtime's fake style object has no setProperty. */
						element.style[name] = value;
					}
				};

				/* ---- the revert farewell: spawn ----
				   Runs BEFORE the park effect on the flip render, so `visualRef`
				   still holds the last live stop when the rail turns idle. The
				   ghost spawns from that captured stop and the spawn effect below
				   springs it home — without this ordering the park effect would
				   already have overwritten the ref with the idle fraction. */
				const [ghost, setGhost] = useState(null);
				const ghostTimerRef = useRef(null);
				const wasIdleRef = useRef(idle);
				useLayoutEffect(() => {
					const was = wasIdleRef.current;
					wasIdleRef.current = idle;
					if (!idle || was || !open || travel <= 0) return void 0;
					setGhost({ from: visualRef.current });
				}, [idle, open, travel]);

				/* ---- park the thumb on the settled value ----
				   `dragging` belongs in the dependencies even though the effect never
				   reads it: releasing a drag must snap the thumb onto its tick, and
				   during a drag the tier is already chosen optimistically, so
				   `fraction` is unchanged by the release and nothing else would
				   re-run this effect. Without it the thumb stayed under the pointer
				   at whatever fraction the drag ended on — which reads as "it never
				   moves to the level". */
				useLayoutEffect(() => {
					if (draggingRef.current) return;
					visualRef.current = fraction;
					const thumb = thumbRef.current;
					const fill = fillRef.current;
					const field = fieldRef.current;
					if (!absent(thumb)) thumb.style.transform = "translateX(" + (fraction * travel) + "px)";
					if (!absent(fill)) fill.style.width = (9 + fraction * travel) + "px";
					/* Park the lattice for the settled stop. The top stop lights the
					   hall at full bleed — a strip always hidden under the thumb's
					   right half is worthless, and without the bleed a high-DPI
					   rounding could leave the last column half-cut at the very
					   stop that is supposed to light it. Any other stop parks the
					   clip and the glow at zero: total darkness, twinkle paused. */
					if (!absent(field) && travel > 0) {
						const glow = latticeGlow(fraction);
						let line = 9 + fraction * travel;
						if (glow >= 1 || line >= travel) line = railWidth - 8;
						if (glow <= 0) line = 0;
						if (glow >= 1) {
							/* Arriving at the top stop is a reveal, not a fade: the
							   sheet unrolls right to left, out from under the parked
							   key, by collapsing a left-folded inset to zero. The
							   two-step write — start the reveal with the transition
							   cut, flush the style once, then let the sheet's
							   transition carry it — is what gives the browser a
							   single-direction interpolation; without it a transition
							   from the drag's right-anchored clip would smear both
							   edges at once. A hold that dipped below the top and
							   climbed back, and a park that was already lit, just
							   finalize instead: re-rolling a lit hall would blink. */
							if (!fieldDippedRef.current && !fieldLitRef.current) {
								field.style.transition = "none";
								field.style.clipPath = "inset(0 0 0 100%)";
								void field.offsetWidth;
								field.style.transition = "";
							}
							fieldDippedRef.current = false;
							fieldLitRef.current = true;
							field.style.clipPath = "inset(0 0 0 0)";
						} else {
							if (field.style.clipPath !== "") field.style.clipPath = "";
							fieldLitRef.current = false;
							fieldDippedRef.current = false;
						}
						writeVar(field, "--te-line", line.toFixed(2) + "px");
						field.style.opacity = glow.toFixed(2);
						writeVar(field, "--te-run", glow > 0 ? "running" : "paused");
					}
				}, [fraction, travel, open, anchor, dragging, railWidth, cancelEpoch]);

				/* ---- the revert farewell: spring the ghost home ----
				   Removing a declaration retires the live rail: the same draw that
				   flips `idle` also hides the thumb and the fill outright, which
				   reads as a hard flash where every other transition in this
				   control is a spring. The ghost (spawned by the watcher above
				   from the key's last resting place) starts there with the
				   transition cut, flushes once, then lets the spring carry it to
				   the rail's left rest while it fades — undoing a declaration
                   gets the motion a level change already has. */
				useLayoutEffect(() => {
					if (ghost === null) return void 0;
					const el = ghostRef.current;
					const fillEl = ghostFillRef.current;
					if (el === null) return void 0;
					const startX = ghost.from * travel;
					el.style.transition = "none";
					el.style.transform = "translateX(" + startX + "px)";
					el.style.opacity = "1";
					if (fillEl !== null && fillEl !== void 0) {
						fillEl.style.transition = "none";
						fillEl.style.width = (9 + startX) + "px";
						fillEl.style.opacity = "1";
					}
					void el.offsetWidth;
					el.style.transition = "";
					el.style.transform = "translateX(0px)";
					el.style.opacity = "0";
					if (fillEl !== null && fillEl !== void 0) {
						fillEl.style.transition = "";
						fillEl.style.width = "9px";
						fillEl.style.opacity = "0";
					}
					const timer = setTimeout(() => setGhost(null), 620);
					ghostTimerRef.current = timer;
					return () => {
						clearTimeout(timer);
						ghostTimerRef.current = null;
					};
				}, [ghost, travel, railWidth]);

				/* EVERY hook above this line, and none below it. React identifies
				   hooks by call order, so an early `return` placed between two hooks
				   makes the next render call more hooks than the previous one and
				   React throws #310 ("Rendered more hooks than during the previous
				   render") — which retires this slot entry and blanks the control.
				   That is exactly what happened: at boot `supported` is false (no
				   directory yet), the return shipped before the effect above, and the
				   control could never appear on a fresh start. `supported` also
				   cannot gate a hook instead: it flips for these same models. */
				if (!supported) return null;

				/* ---- drop the effort, keep the model ----
				   A selection WITHOUT an effort is the one the Host accepts for a
				   model that takes no level, and it is also the selection that
				   leaves no stranded level behind: the Host saves it as the
				   global default, so the dead level leaves `agent-default-model`
				   with it.

				   It is the repair for a REMOVED declaration (the projection still
				   names the level that no longer exists) and for a level the Host
				   does not accept. */
				const clearEffort = () => {
					if (absent(directory) || typeof directory.select !== "function") return;
					const generation = ++generationRef.current;
					pendingRef.current = null;
					setPending(null);
					chosenRef.current = null;
					setChosen(null);
					try {
						const result = directory.select({
							provider: info.provider,
							model: info.model
						});
						if (!absent(result) && typeof result.catch === "function") {
							result.catch(() => void 0);
						}
					} catch (error) {
						/* A refused reset leaves the level in place; the footer keeps
						   reporting it, which is honest. */
					}
					void generation;
				};

				/* The repair a stranded level offers: the same model, no effort. */
				const resetToDefault = () => {
					clearEffort();
				};

				const commit = (next) => {
					if (next < 0 || next > count - 1) return;
					const level = shownEfforts[next];
					if (absent(level)) return;
					const levelId = level.id;

					/* The store's level is only "already selected" when the model
					   actually offers it AND it is the level in force. A selection
					   that outlived the ladder it was made against — a different
					   model, or a ladder that was narrowed or removed — leaves the
					   store holding a level the model cannot take. Treating that
					   as "already selected" swallowed the click: the control
					   looked frozen on the very level the user was trying to
					   leave. */
					if (next === info.index && info.activeOffered && info.activeId === levelId) {
						chosenRef.current = null;
						setChosen(null);
						return;
					}

					/* A request already in flight for the SAME level needs no
					   second one; a request for a DIFFERENT level supersedes it,
					   and the generation below makes the older answer harmless. */
					chosenRef.current = next;
					setChosen(next);
					const generation = ++generationRef.current;
					const request = { levelId, index: next };
					pendingRef.current = request;
					setPending(request);

					/* The optimistic position is held until the STORE agrees, not
					   until the RPC settles. The durable projection reaches the
					   store a round trip LATER than the RPC answers: `selectModel`
					   appends `model/selection` to the session and only then does
					   the projection carry it back. Releasing on the RPC alone
					   snapped the key back to the PREVIOUS level — which read as
					   "the click did nothing" — and on a store holding a level the
					   model cannot take, that previous level was the very top
					   stop, so every press looked like a frozen control.

				   The wait is bounded: a projection that never arrives (a failed
				   write, a lost connection) must not pin the key forward forever,
				   and a REFUSED request must give the level back at once. */
					const release = () => {
						if (generation !== generationRef.current) return;
						pendingRef.current = null;
						setPending(null);
						chosenRef.current = null;
						setChosen(null);
					};
					const timer = setTimeout(release, 5000);

					let result;
					try {
						result = directory.select({
							provider: info.provider,
							model: info.model,
							reasoningEffort: levelId
						});
					} catch (error) {
						clearTimeout(timer);
						release();
						return;
					}
					if (absent(result) || typeof result.then !== "function") {
						clearTimeout(timer);
						release();
						return;
					}
					result.then(
						(outcome) => {
							clearTimeout(timer);
							/* A refusal gives the level back immediately: the store
							   keeps the previous level and the control must show
							   it again rather than claim a level that was never
							   accepted. */
							if (outcome !== null && outcome !== void 0 && outcome.ok === false) {
								release();
								return;
							}
							/* A success keeps the optimistic position until the
							   projection confirms it — see the note above. */
						},
						() => {
							clearTimeout(timer);
							release();
						}
					);
				};

				const positionFor = (clientX) => {
					const rail = railRef.current;
					if (absent(rail) || travel <= 0) return 0;
					const box = rail.getBoundingClientRect();
					const raw = (clientX - box.left - PAD) / travel;
					return raw < 0 ? 0 : raw > 1 ? 1 : raw;
				};

				const paint = (value) => {
					visualRef.current = value;
					const thumb = thumbRef.current;
					const fill = fillRef.current;
					const field = fieldRef.current;
					if (!absent(thumb)) thumb.style.transform = "translateX(" + (value * travel) + "px)";
					if (!absent(fill)) fill.style.width = (9 + value * travel) + "px";
					/* The lattice tracks the pointer raw: the clip line follows the
					   thumb (columns beyond it die under the hand, not stop by
					   stop), and the glow ramps across the boundary zone so the
					   hall melts away — or relights — between the top two stops
					   instead of snapping at the tier edge. */
					if (!absent(field) && travel > 0) {
						const glow = latticeGlow(value);
						/* The parked max keeps its left-folded inset inline; a running
						   drag paints through the var-based thumb line again. */
						if (field.style.clipPath !== "") field.style.clipPath = "";
						if (glow < 1) fieldDippedRef.current = true;
						writeVar(field, "--te-line", (9 + value * travel).toFixed(2) + "px");
						field.style.opacity = glow.toFixed(2);
						writeVar(field, "--te-run", glow > 0 ? "running" : "paused");
					}
				};

				const pushChoice = (next) => {
					if (chosenRef.current === next) return;
					chosenRef.current = next;
					setChosen(next);
				};

				const onPointerDown = (event) => {
					if (idle || travel <= 0) return;
					draggingRef.current = true;
					fieldDippedRef.current = false;
					setDragging(true);
					try {
						event.currentTarget.setPointerCapture(event.pointerId);
					} catch (error) {
						/* pointer capture is best-effort */
					}
					/* A press never jumps: painting the pressed spot here started the
					   spring and the drag class flip cut it a frame later — the
					   teleport that read as a hard flash. The gesture only moves the
					   key once it proves itself a drag (past the engage threshold in
					   onPointerMove) or commits as a click in onPointerUp; both then
					   travel from where the key sits, under the spring. */
					gestureRef.current = { value: positionFor(event.clientX), engaged: false };
					event.preventDefault();
				};

				const onPointerMove = (event) => {
					if (idle || !draggingRef.current || travel <= 0) return;
					const gesture = gestureRef.current;
					if (gesture === null) return;
					const value = positionFor(event.clientX);
					if (!gesture.engaged) {
						if (Math.abs(value - gesture.value) < 0.02) return;
						gesture.engaged = true;
					}
					paint(value);
					pushChoice(Math.round(value * (count - 1)));
				};

				const onPointerUp = () => {
					if (!draggingRef.current) return;
					draggingRef.current = false;
					setDragging(false);
					const gesture = gestureRef.current;
					gestureRef.current = null;
					/* A click commits the pressed position without ever painting it:
					   the park effect springs the key across the rail to the chosen
					   stop, which is the whole travel the user asked to see. */
					commit(Math.round((gesture !== null && !gesture.engaged ? gesture.value : visualRef.current) * (count - 1)));
				};

				/* A stolen pointer (touch scroll, gesture takeover) aborts instead of
				   committing: a cancel was never a decision about a level. */
				const onPointerCancel = () => {
					if (!draggingRef.current) return;
					draggingRef.current = false;
					gestureRef.current = null;
					/* Drop any optimistic level the drag pushed, and bump the epoch so
					   the park effect re-runs even when the flip changed nothing: a
					   cancelled key springs back to the level the store holds. */
					if (chosenRef.current !== null) {
						chosenRef.current = null;
						setChosen(null);
					}
					setDragging(false);
					setCancelEpoch((value) => value + 1);
				};

				const onKeyDown = (event) => {
					let next = null;
					if (idle) return;
					if (event.key === "ArrowLeft" || event.key === "ArrowDown") next = index - 1;
					else if (event.key === "ArrowRight" || event.key === "ArrowUp") next = index + 1;
					else if (event.key === "Home") next = 0;
					else if (event.key === "End") next = count - 1;
					else return;
					if (next < 0) next = 0;
					if (next > count - 1) next = count - 1;
					event.preventDefault();
					commit(next);
				};

				const level = shownEfforts[index];
				const label = !absent(level) && typeof level.name === "string" ? level.name : "";
				/* Name the active level only when the model really is on one; while a
				   drag is in flight the dragged level is named instead, and a model
				   that declared nothing keeps saying "provider default" until a level
				   is accepted. */
				const tierName = !absent(chosen) || info.activeKnown
					? (label.length > 0 ? label : info.display)
					: t("effort.providerDefault");
				const description = !absent(level) && typeof level.description === "string"
					? level.description
					: "";
				const valueText = format(t("a11y.value"), { name: tierName, index: index + 1, count });

				const ticks = [];
				for (let i = 0; i < count; i++) {
					ticks.push(h("span", {
						key: "tick:" + i,
						className: i <= index ? "te-tick te-tickOn" : "te-tick",
						style: { left: (PAD + (count > 1 ? i / (count - 1) : 0) * travel) + "px" },
						"aria-hidden": "true"
					}));
				}

				const cells = field.cells.map((cell) => {
					/* Every cell carries its own weight; only the twinkling ones also
					   carry a period and a stagger. `--te-o` is what makes the field
					   uneven where nothing is moving. */
					const style = { "--te-o": cell.weight };
					if (cell.blink) {
						style["--te-d"] = cell.duration;
						style["--te-dl"] = cell.delay;
					}
					return h("span", {
						key: cell.key,
						className: cell.blink ? "te-cell te-cellBlink" : "te-cell",
						style
					});
				});

				const fieldStyle = field.cols > 0 ? {
					gridTemplateColumns: "repeat(" + field.cols + "," + FIELD_CELL + "px)",
					gridTemplateRows: "repeat(" + FIELD_ROWS + "," + FIELD_CELL + "px)"
				} : void 0;

				const panelClass = "te-panel" + (isMax ? " te-max" : "") + (failed ? " te-err" : "");
				const railClass = "te-rail" + (dragging ? " te-railDrag" : "") + (idle ? " te-railIdle" : "");

				/* The footer states share one line of geometry:
				   a level description (the only one that needs a reserve),
				   a failed selection, the ladder-management line — "has no
				   levels" with the ONE-CLICK ENABLE that fixes it, "enabled by
				   this plugin" with the action that undoes that — and, when
				   there is NEITHER text nor action and the chooser is closed,
				   nothing at all: reserving a second line under an empty one
				   printed a bare blank strip under the rail, the layout bug
				   this shape fixed. While the chooser is open the footer
				   vanishes entirely; the chooser carries the conversation, and
				   printing a second, competing action button underneath it
				   helped nobody.

				   The enable follows human logic: it must not require a form.
				   The button writes the suggested ladder directly; "自定义…"
				   is the only door into the picker and deliberately styled as
				   a quiet link, so the detour never reads as the default ask.
				   The action stays attached to the error too — a refusal reads
				   as "this failed: why — and here is the way to retry". */
				let footerClass = "te-foot";
				let footerText = description;
				let footerAction = null;
				if (failed) {
					footerClass += " te-footErr";
					footerText = t("state.failed");
				} else if (strandedId !== null) {
					/* The session still names a level the Host will not accept.
					   Repairing it silently would rewrite the user's global
					   default as a side effect of opening the composer, so it is
					   reported with the one action that fixes it: selecting the
					   same model without an effort. */
					footerClass += " te-footErr";
					footerText = t("state.stranded");
					footerAction = "reset";
				} else if (idle && chooserOpen) {
					footerText = "";
				} else if (idle) {
					/* First the action, THEN the text: a write refusal keeps its
					   retry button instead of replacing the affordance with the
					   complaint. */
					footerAction = declare.state === "ours" ? "revert"
						: declare.state === "undeclared" ? "enable" : null;
					if (declare.code.length > 0) {
						footerClass += " te-footErr";
						footerText = format(t("act.failed"), { detail: t("why." + declare.code) });
					} else {
						footerClass += " te-footNote";
						if (declare.state === "nonreasoning") {
							footerText = t("state.nonreasoning");
						} else if (declare.state === "ours") {
							/* Revertible even for a CUSTOMIZED set: "ours" now means the
							   plugin's declaration shape, not one exact ladder. */
							footerText = t("state.ours");
						} else if (declare.state === "undeclared" ||
							declare.state === "checking" || declare.state === "idle") {
							footerText = t("state.undeclared");
						} else {
							footerText = t("state.undeclared") + t("state.unmanageable");
						}
					}
				} else if (info.ours || declare.state === "ours") {
					/* The Host's own verdict decides whether the removal is offered:
					   the local `info.ours` only recognises the plugin's declaration
					   SHAPE, while the Host also knows whether the ladder is still
					   there. A refusal must be shown in place — swallowing it left
					   the button looking inert, which is what a dead control looks
					   like.

					   A ladder the Host says is NOT ours removes the removal action
					   even when the local shape matched: the catalogue can be stale,
					   and the Host is the authority. */
					const removable = declare.state === "ours" ||
						(declare.state === "idle" && info.ours);
					footerClass += " te-footNote";
					footerText = t("state.ours");
					footerAction = removable ? "revert" : null;
					if (declare.code.length > 0) {
						footerClass += " te-footErr";
						footerText = format(t("act.failed"), { detail: t("why." + declare.code) });
					}
				} else {
					footerClass += " te-footDesc";
				}

				/* The primary is the whole default path — enabling never needs
				   the chooser now — and reverting still drops the draft first:
				   a stale draft would describe a ladder that no longer exists.

				   A REMOVAL also has to clear the session's own level: the
				   durable projection keeps naming the level that was just
				   removed, and the request path would then refuse every
				   request for this model. The Host saves that effort-free
				   selection as the global default too, so the strand leaves
				   `agent-default-model` as well — which is what stops the NEXT
				   session from starting on a level that no longer exists. */
				const onFooterAction = () => {
					if (footerAction === "enable") {
						if (idle) oneClickEnable();
						return;
					}
					if (footerAction === "reset") {
						resetToDefault();
						return;
					}
					setDraftIds(null);
					declare.apply("revert").then((outcome) => {
						if (outcome.ok !== true) return;
						clearEffort();
					}, () => {});
				};
				const footer = chooserOpen || (footerText.length === 0 && footerAction === null) ? null : h(
					"div",
					{ className: footerClass },
					footerText,
					footerAction === null ? null : h(
						"button",
						{
							type: "button",
							className: "te-act",
							disabled: declare.busy,
							onClick: onFooterAction
						},
						declare.busy ? t("act.pending") : t(
							footerAction === "enable" ? "act.declare"
								: footerAction === "reset" ? "act.reset"
									: "act.revert"
						)
					),
					footerAction === "enable" ? h(
						"button",
						{
							type: "button",
							className: "te-footAlt",
							disabled: declare.busy,
							onClick: () => setChooser(true)
						},
						t("act.custom")
					) : null
				);

				const panel = !open || absent(anchor) ? null : h(
					"div",
					{
						className: panelClass,
						"data-te-panel": "",
						role: "dialog",
						"aria-label": t("label"),
						style: { left: anchor.left + "px", bottom: anchor.bottom + "px" }
					},
					h(
						"div",
						{ className: "te-head" },
						h("span", { className: "te-kicker" }, t("label")),
						h("span", { className: isMax ? "te-tier te-tierMax" : "te-tier" }, tierName),
						h(
							"button",
							{ type: "button", className: "te-help", "aria-label": t("help") },
							"?",
							h("span", { className: "te-helpTip" }, t("help"))
						)
					),
					h(
						"div",
						{ className: "te-axis" },
						h("span", null, t("axis.faster")),
						h("span", null, t("axis.smarter"))
					),
					h(
						"div",
						{
							className: railClass,
							ref: railRef,
							onPointerDown,
							onPointerMove,
							onPointerUp,
							onPointerCancel
						},
						h("span", { className: "te-fill", ref: fillRef, "aria-hidden": "true" }),
						h("span", { className: "te-field", ref: fieldRef, style: fieldStyle, "aria-hidden": "true" }, cells),
						ticks,
						idle && ghost !== null ? h("span", { className: "te-ghostFill", ref: ghostFillRef, "aria-hidden": "true" }) : null,
						idle && ghost !== null ? h("span", { className: "te-ghost", ref: ghostRef, "aria-hidden": "true" }) : null,
						idle ? null : h("button", {
							type: "button",
							className: "te-thumb",
							ref: thumbRef,
							role: "slider",
							tabIndex: 0,
							"aria-valuemin": 1,
							"aria-valuemax": count,
							"aria-valuenow": index + 1,
							"aria-valuetext": valueText,
							"aria-label": t("label"),
							"aria-disabled": busy,
							onKeyDown
						})
					),
					chooserOpen ? h(DeclareChooser, {
						t,
						declare,
						info,
						onDraft: (ids) => setDraftIds(ids),
						onClose: () => setChooser(false)
					}) : null,
					footer
				);

				/* Keep the current level as the sole readout. The outlined horizontal
				   slider describes the action without the old three-bar staircase;
				   the disclosure arrow identifies the popover. Both are decorative. */
				const chipLabel = info.display.length > 0 ? info.display : t("effort.providerDefault");
				return h(
					Fragment,
					null,
					h(
						"button",
						{
							ref: chipRef,
							type: "button",
							className: "te-chip",
							"data-te-chip": "",
							"aria-haspopup": "dialog",
							"aria-expanded": open,
							"aria-label": t("label") + "：" + chipLabel,
							title: t("label") + "：" + chipLabel,
							onClick: () => setOpen(!open)
						},
						h(
							"svg",
							{
								className: "te-chipIcon",
								viewBox: "0 0 16 16",
								width: 14,
								height: 14,
								fill: "none",
								stroke: "currentColor",
								strokeWidth: 1.4,
								strokeLinecap: "round",
								strokeLinejoin: "round",
								"aria-hidden": "true",
								focusable: "false"
							},
							h("path", { d: "M1.5 8h5m4 0h4" }),
							h("rect", { x: 6.5, y: 4.5, width: 4, height: 7, rx: 1.4 })
						),
						h("span", { className: "te-chipLabel" }, chipLabel),
						h(
							"svg",
							{
								className: "te-chipChevron",
								viewBox: "0 0 12 12",
								width: 10,
								height: 10,
								fill: "none",
								stroke: "currentColor",
								strokeWidth: 1.4,
								strokeLinecap: "round",
								strokeLinejoin: "round",
								"aria-hidden": "true",
								focusable: "false"
							},
							h("path", { d: "m3 4.5 3 3 3-3" })
						)
					),
					panel
				);
			};
		}

		return {
			inject: ["slots"],
			apply(ctx) {
				ctx.effect(() => {
					if (typeof document === "undefined") return () => {};
					const existing = document.querySelector('style[data-plugin-css="' + STYLE_ID + '"]');
					if (existing !== null) return () => {};
					const tag = document.createElement("style");
					tag.dataset.plugin = PACKAGE;
					tag.dataset.pluginCss = STYLE_ID;
					tag.textContent = CSS;
					document.head.appendChild(tag);
					return () => {
						if (tag.parentNode !== null) tag.parentNode.removeChild(tag);
					};
				}, "thinking-effort: stylesheet");

				/* Optional services: without them the plugin stays inactive. */
				ctx.inject(["slots", "modelDirectories", "locale"], (scope) => {
					scope.effect(() => scope.locale.register(NS, DICT), "thinking-effort: dictionaries");
					const models = scope.modelDirectories;
					const directoryCache = new Map();
					/* The entry renders nothing in the composer; it exists to carry the
					   per-session `sessionId` that the rail's portal needs, and it rides
					   the composer row that is always mounted for a live Session. */
					scope.slots.inject("conversation.input.right", () => scope.slots.register({
						name: "conversation.input.right",
						id: "thinking-effort",
						order: 10,
						locale: NS
					}, makeControl(models, directoryCache)));
				});
			}
		};
	}
});
