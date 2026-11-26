// a vendored ES5 library: copied to dist as it is, never compiled, so the
// upgrade pass must not read it. its setData is its own.
function Series(options) {
	this.setData(options.data, false);
}
Series.prototype.setData = function (data) {
	this.data = data;
};
