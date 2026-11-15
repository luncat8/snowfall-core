/* story.js — the one story every VN-mode variant reads, in the engine's own
	free notation: raw text cut by <br>, paragraphs, wagons anywhere, inert
	event scripts, style anchors, parked sticks. Every line says where it is,
	so a misplaced page or a picture that left its text is visible at a glance.

	What the content is built to provoke:
	  slate   no picture — only the theme colour; raw <br> portions and <p>
	  red     cover picture, top exit; single lines and many-line stanzas, a
	          script mid-run; longer than a screen
	  green   left exit; a caption parked at the top, a tag parked at the bottom
	  blue    picture placed loose between two lines, right exit; one portion
	          taller than any screen
	  gold    bottom exit; night → day theme; a choice the story waits for
	  violet  small fixed-size picture; the one chapter shorter than a screen
	  night   last picture; the story ends over it with no picture of its own

	A line that follows a paragraph is a paragraph itself: the stop walk cuts
	at a <p>'s start, never at its end, so loose text after </p> would join
	the paragraph's portion.

	Chapters are longer than a screen on purpose, by different amounts: two
	pictures closer than one picture's height push each other before either
	has parked, and each then runs ahead of its own text.

	The numbered scripts (mark 1…12) are the sequence gate: the log counts
	them and flags any that fire out of order or are skipped. */
(function() {
'use strict';
const MARKS = 12;

function art(letter, a, b, c) {
	let rails = '';
	for (let y = 90; y < 900; y += 90) rails += "<path d='M0 " + y + "H1600'/>";
	const svg = "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1600 900' preserveAspectRatio='xMidYMid slice'>"
		+ "<defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'>"
		+ "<stop offset='0' stop-color='" + a + "'/><stop offset='.6' stop-color='" + b + "'/><stop offset='1' stop-color='" + c + "'/>"
		+ "</linearGradient></defs>"
		+ "<rect width='1600' height='900' fill='url(#g)'/>"
		+ "<g stroke='#fff' stroke-opacity='.09' stroke-width='2'>" + rails + "</g>"
		+ "<circle cx='1270' cy='210' r='130' fill='#fff' fill-opacity='.13'/>"
		+ "<circle cx='300' cy='700' r='70' fill='#000' fill-opacity='.14'/>"
		+ "<text x='800' y='640' font-size='560' font-family='Georgia,serif' font-weight='700' text-anchor='middle' fill='#fff' fill-opacity='.17'>" + letter + "</text>"
		+ "</svg>";
	return 'url("data:image/svg+xml,' + encodeURIComponent(svg) + '")';
}
const ART = {
	R: art('R', '#3d0a10', '#b3261e', '#ff9d7a'),
	G: art('G', '#06250f', '#1f7a3a', '#b7e37a'),
	B: art('B', '#071433', '#1f4fb0', '#7fd0ff'),
	Y: art('Y', '#c98a12', '#f2c94c', '#fff3c2'),
	V: art('V', '#2a0f52', '#7b3fd1', '#e3b8ff'),
	N: art('N', '#02030a', '#141c3d', '#3b2f6b')
};

/* a portion taller than any screen: numbered sentences, so the place inside
	it is always readable */
function longRun(n) {
	let s = '';
	for (let i = 1; i <= n; i++) s += 'B6.' + (i < 10 ? '0' : '') + i + ' the bridge keeps going. ';
	return s;
}
/* one portion of many numbered lines: height between two pictures without a
	tap for every line */
function stanza(letter, from, to) {
	let s = '<p class="stanza">';
	for (let i = from; i <= to; i++) {
		let run = '';
		for (let k = 0; k <= i % 5; k++) run += ' ' + letter;
		s += '<span>' + letter + i + ' ·' + run + '</span>';
	}
	return s + '</p>';
}

const STORY = `
<header class="title">
	<h1>the colour line</h1>
	<div class="sub">one story, read five ways — every line says where it is</div>
</header>

<section id="slate" data-bg="#10151f" data-fg="#dfe8f5">
	<script type="txt" event="view,skip">mark(1, 'slate · story opens', detail); place('slate · ticket hall')</script>
	S1 · Raw text sits straight in the section, cut into portions by line breaks.<br>
	S2 · No picture yet: only the page colour, and that colour is the theme.<br>
	S3 · Tap or Space takes one step. Backspace takes it back.<br>
	<p>S4 · A paragraph is a portion too. Ahead, the line is painted in colours: every
	picture rides in with its own first line, parks at the top edge, and leaves only
	when the next one pushes it out.</p>
	<p>S5 · Watch three things: the pictures pushing each other, the page colour turning
	between chapters, and the script log counting up in order.</p>
	<p>S6 · Last slate line. Red is next.</p>
</section>

<section id="red" data-bg="#2a0d10" data-fg="#ffe9e2">
	<div class="snow-bg" data-mode="cover" data-art="R"></div>
	<script type="txt" event="view,skip">mark(2, 'red · picture enters', detail); place('red · platform one')</script>
	<script type="txt" event="parked">note('red · picture parked', detail)</script>
	<script type="txt" event="end">note('red · first line left the top', detail)</script>
	<h2>RED</h2>
	R1 · The red picture came in with this line.<br>
	R2 · It parks at the top edge and stays while red is read.<br>
	${stanza('R', 3, 12)}
	<p>R13 · One line on its own.</p>
	<script type="txt" event="view,skip">mark(3, 'red · halfway', detail)</script>
	<p>R14 · A script sits just above this line.</p>
	${stanza('R', 15, 26)}
	<p>R27 · When green arrives, its top edge meets red's bottom edge and pushes red
	out by the top. Nothing overlaps.</p>
	${stanza('R', 28, 37)}
	<p>R38 · Last red line.</p>
</section>

<section id="green" data-bg="#0c2415" data-fg="#e6ffe9">
	<div class="snow-bg" data-mode="cover" data-art="G" data-dir="left"></div>
	<script type="txt" event="view,skip">mark(4, 'green · picture enters', detail); place('green · the orchard')</script>
	<script type="txt" event="parked">note('green · picture parked', detail)</script>
	<div class="snow-stick cap" data-park="top:calc(var(--bar-h) + .5rem)">GREEN · a caption parked at the top</div>
	<h2>GREEN</h2>
	<p>G1 · Green is written in paragraphs. Its picture leaves to the left.</p>
	<p>G2 · The caption above stays parked while this chapter is on screen, and the
	tag at the end of the chapter waits at the bottom edge until its own line arrives.</p>
	${stanza('G', 3, 11)}
	<p>G12 · The orchard runs beside the track for a while.</p>
	<script type="txt" event="view,skip">mark(5, 'green · the thirteenth line', detail)</script>
	<p>G13 · A script sits just above this paragraph.</p>
	${stanza('G', 14, 25)}
	<p>G26 · Last green paragraph.</p>
	<div class="snow-stick tag" data-park="bottom:1rem">orchard halt · a tag parked at the bottom</div>
</section>

<section id="blue">
	B0 · A new section opens here, and green's picture is still up.<br>
	<div class="snow-bg" data-mode="cover" data-art="B" data-dir="right" data-bg="#0b1830" data-fg="#e4eeff"></div>
	<script type="txt" event="view,skip">mark(6, 'blue · picture enters', detail); place('blue · the long bridge')</script>
	<script type="txt" event="parked">note('blue · picture parked', detail)</script>
	<h2>BLUE</h2>
	B1 · Blue starts between two lines, not at a section edge.<br>
	B2 · Its picture will leave to the right.<br>
	${stanza('B', 3, 5)}
	<p class="long">B6 · This portion is taller than the screen on purpose. ${longRun(90)}B6 ends here.</p>
	<script type="txt" event="view,skip">mark(7, 'blue · after the long portion', detail)</script>
	<p>B7 · The line after the long portion.</p>
	<p>B8 · Last blue line.</p>
</section>

<section id="gold" data-bg="#f4ecd8" data-fg="#2b2110" data-style="day">
	<div class="snow-bg" data-mode="cover" data-art="Y" data-dir="bottom"></div>
	<script type="txt" event="view,skip">mark(8, 'gold · picture enters', detail); place('gold · the bright room')</script>
	<script type="txt" event="parked">note('gold · picture parked', detail)</script>
	<h2>GOLD</h2>
	<p>Y1 · A door opens onto a bright room: the page turns from night to day as you
	cross it, never in one blink.</p>
	${stanza('Y', 2, 9)}
	<p>Y10 · Two doors wait in this room.</p>
	<script type="txt" event="view,skip" data-id="door">mark(9, 'gold · the question', detail); askDoor()</script>
	<p>Y11 · Choose one below. In VN mode the story waits for the answer.</p>
	<p>Y12 · You took the <b id="door">unopened</b> door.</p>
	${stanza('Y', 13, 24)}
	${stanza('Y', 25, 33)}
	<p>Y34 · Gold leaves by the bottom edge.</p>
</section>

<section id="violet" data-bg="#1c1030" data-fg="#f1e6ff">
	<div class="snow-bg" data-art="V" data-mode="fixed" data-size="340x340"></div>
	<script type="txt" event="view,skip">mark(10, 'violet · small picture enters', detail); place('violet · the alcove')</script>
	<h2>VIOLET</h2>
	V1 · A small fixed-size picture: the page colour shows around it.<br>
	V2 · This chapter is shorter than a screen, so night is already in sight.<br>
	${stanza('V', 3, 12)}
	<p>V13 · Last violet line.</p>
</section>

<section id="night" data-bg="#06080f" data-fg="#cdd6f4">
	<div class="snow-bg" data-mode="cover" data-art="N"></div>
	<script type="txt" event="view,skip">mark(11, 'night · picture enters', detail); place('night · last platform')</script>
	<script type="txt" event="parked">note('night · picture parked', detail)</script>
	<h2>NIGHT</h2>
	<p>N1 · Night comes in under the small picture and pushes it away.</p>
	${stanza('N', 2, 11)}
	<p>N12 · The lamps go by one at a time.</p>
	<p>N13 · Last night line.</p>
	<section id="end">
	<script type="txt" event="view,skip">mark(12, 'end · story closes', detail); place('end of the line')</script>
	<h2>END</h2>
	E1 · No new picture for the end: night stays parked behind these lines.<br>
	E2 · Step back with Backspace — every push runs in reverse.<br>
	</section>
</section>
`;

const app = document.getElementById('app');
app.innerHTML = STORY;
const pictures = app.querySelectorAll('[data-art]');
for (let i = 0; i < pictures.length; i++) pictures[i].style.backgroundImage = ART[pictures[i].dataset.art];

/* ---- what the story's scripts call ---- */
const rig = () => window.VN;
window.mark = function(n, text, detail) {
	const V = rig(), M = V.marks;
	const skipped = detail.event === 'skip';
	let gap = false;
	for (let i = 1; i < n; i++) if (!M.seen[i]) gap = true;
	if (gap) M.bad++;
	if (skipped) M.skips++;
	const again = !!M.seen[n];
	M.seen[n] = 1;
	V.log(skipped || gap ? 'bad' : again ? 'dim' : 'mark',
		n + '/' + MARKS + ' ' + text + (skipped ? ' — SKIPPED' : gap ? ' — OUT OF ORDER' : again ? ' (again)' : ''));
};
window.note = function(text, detail) { rig().log('note', detail.event + ' · ' + text); };
window.place = function(text) { rig().place(text); };
window.askDoor = function() {
	window.Snowfall.ask('door', 'left', [['the left door', 'left'], ['the right door', 'right']], function(value, mode) {
		document.getElementById('door').textContent = value;
		rig().log('ask', 'door = ' + value + ' (' + mode + ')');
	});
};
window.VN_STORY = {
	marks: MARKS,
	reset: function() { document.getElementById('door').textContent = 'unopened'; }
};
})();
