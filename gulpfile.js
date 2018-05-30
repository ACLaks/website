'use strict';
const path = require('path');
const fs = require('fs');
const cp = require('child_process');

const colors = require('ansi-colors');
const log = require('fancy-log');

const gulp = require('gulp');
const eventStream = require('event-stream');

const Vinyl = require('vinyl')
const watch = require('gulp-watch');
const batch = require('gulp-batch');
const plumber = require('gulp-plumber');

const through = require('through2');
const server = require('gulp-server-livereload');

const sass = require('gulp-sass');
const sourcemaps = require('gulp-sourcemaps');

const changed = require("gulp-changed");
const rename = require("gulp-rename");
const imageResize = require('gulp-image-resize');

gulp.task('packages', function () {
	function npmSrc(srcs) {
		return gulp.src(srcs.map(p => './node_modules/' + p));
	}

	return eventStream.merge([
		npmSrc([
			'slick-carousel/slick/slick.min.js',
			'slick-carousel/slick/slick.css',
			'slick-carousel/slick/slick-theme.css',
		]).pipe(gulp.dest('./packages')),

		npmSrc(['slick-carousel/slick/fonts/*'])
			.pipe(gulp.dest('./packages/fonts')),
	]);
});

gulp.task('default', function () {
	const styleSrcs = gulp.src(['./style/src/[^_]*.scss']);
	return eventStream.merge([
		styleSrcs
			.pipe(plumber(function (error) {
				log(
					colors.cyan('Plumber') + colors.red(' caught an unhandled error:\n'),
					error.messageFormatted || error.toString()
				);
				this.emit('end');
			}))
			.pipe(sourcemaps.init())
			.pipe(sass())
			.pipe(sourcemaps.mapSources(sourcePath => './src/' + sourcePath))
			.pipe(sourcemaps.write('./', { includeContent: false }))
			.pipe(gulp.dest('./_site/style')),

		// Copy originals for reference by source maps (this is also where Jekyll puts them).
		styleSrcs
			.pipe(gulp.dest('./_site/style/src')),

		// Auto-generate import stubs for Jekyll
		styleSrcs
			.pipe(generateFile(file => new Vinyl({
				path: path.basename(file.path),
				contents: Buffer.from(`---\n---\n@import "./src/${path.basename(file.path, '.scss')}";\n`),
			})))
			.pipe(gulp.dest('./style'))
	]);
});

gulp.task('jekyll-watch', ['packages'], function (realDone) {
	function done(...args) {
		realDone(...args);
		done = function () { };
	}
	const jekyll = cp.spawn(
		'bundle', ['exec', 'jekyll', 'build', '--watch', '--config', '_config.yml,_config.dev.yml'],
		{ stdio: ['pipe', 'pipe', 'inherit'], shell: true }
	);
	jekyll.stdout.on('data', buffer => {
		const out = buffer.toString();
		out.replace(/\s+$/, '').split(/\r?\n/).forEach(line => log(colors.cyan('Jekyll') + ': ' + line));

		out.includes('done in ') && done();
	});
	// If Jekyll fails to start watching, terminate everything.
	jekyll.on('exit', () => done(new Error('Jekyll exited unexpectedly')));

	process.on("SIGINT", function () {
		log(colors.red('Caught Ctrl+C; exiting'));
		jekyll.kill();
		process.exit();
	});

	// Catch Ctrl+C before the batch file.  https://stackoverflow.com/a/14861513/34397
	if (process.platform === "win32") {
		var rl = require("readline").createInterface({
			input: process.stdin,
			output: process.stdout
		});

		rl.on("SIGINT", function () {
			process.emit("SIGINT");
		});
	}
});

// Make sure the Jekyll watcher builds successfully first.
gulp.task('watch', ['jekyll-watch'], function () {
	watch('./style/src/*.scss', batch((events, done) => gulp.start('default', done)));
	watch(productImages, batch((events, done) => gulp.start('thumbnails', done)));
});

gulp.task('server', ['default', 'watch', 'thumbnails'], function () {
	gulp.src('./_site')
		.pipe(server({
			livereload: {
				enable: true,
				filter: (filePath, cb) => cb(!(/\.scss$/.test(filePath)))
			},
			open: true
		}));
});

const productImages = './images/products/*.jpg';
gulp.task('thumbnails', () => {
	const dest = './images/products/thumbnails/';

	function resizeTo(opts) {
		if (typeof opts === 'number') opts = { width: opts };
		return gulp.src(productImages)
			.pipe(rename(path => { path.basename += '.' + (opts.width || (opts.height + 'h')); }))
			.pipe(changed(dest))
			.pipe(imageResize({ ...opts, noProfile: true }))
			.pipe(gulp.dest(dest));
	}

	return eventStream.merge([
		resizeTo(270),				// Thumbnails in home page at full width.
		resizeTo({ height: 72 }),	// Nav thumbnails in product page.
		resizeTo({ height: 400 }),	// Full-size preview in product page.
	]);
})


function generateFile(cb) {
	return through.obj((file, encoding, outerCallback) => outerCallback(null, cb(file)));
};
