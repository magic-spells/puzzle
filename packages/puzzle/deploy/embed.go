// Package deploy holds the host config templates that `puzzle add deploy`
// copies into an app (D193). The files in this folder are the templates
// themselves, so they double as plain examples: copy one by hand and it works
// the same.
//
// each host has one template per routing shape. "spa" serves the spa and
// output: 'hybrid' builds alike: a real file (hybrid's prerendered
// dist/<path>/index.html included) wins, and every other path gets the shell
// so the router draws it. "static" serves output: 'static' builds: clean urls
// and a real 404 page, never the shell.
package deploy

import (
	"embed"
	"strings"
)

// FS holds every template. the all: prefix keeps the files whose names start
// with "_" or "." (cloudflare's _headers, apache's .htaccess), which a plain
// directory embed would silently drop.
//
//go:embed all:vercel all:netlify all:cloudflare all:nginx all:apache
var FS embed.FS

// Place says where a template lands in the app.
type Place int

const (
	// AppRoot puts the file beside package.json, where the host reads its
	// project config (vercel.json, netlify.toml) or where the user keeps a
	// server snippet (nginx.conf).
	AppRoot Place = iota
	// Public puts the file in the app's public folder (app/public/, or
	// public/ when that is the one the app uses), so puzzle build copies it to
	// dist/ as is. hosts that read their config from the published folder
	// (cloudflare's _headers, apache's .htaccess) need this.
	Public
)

// File is one template and where it goes.
type File struct {
	// Template is the path inside FS.
	Template string
	// Name is the file name written in the app.
	Name string
	// Place is the app folder Name is written into.
	Place Place
}

// Host is one deploy target.
type Host struct {
	// Name is what the user types: puzzle add deploy <name>.
	Name string
	// Label is the host's own name, for messages.
	Label string
	// SPA is written for spa and hybrid builds.
	SPA []File
	// Static is written for output: 'static' builds.
	Static []File
}

// Hosts lists every target in the order the cli and the docs show them.
var Hosts = []Host{
	{
		Name:   "vercel",
		Label:  "Vercel",
		SPA:    []File{{Template: "vercel/spa/vercel.json", Name: "vercel.json", Place: AppRoot}},
		Static: []File{{Template: "vercel/static/vercel.json", Name: "vercel.json", Place: AppRoot}},
	},
	{
		Name:   "netlify",
		Label:  "Netlify",
		SPA:    []File{{Template: "netlify/spa/netlify.toml", Name: "netlify.toml", Place: AppRoot}},
		Static: []File{{Template: "netlify/static/netlify.toml", Name: "netlify.toml", Place: AppRoot}},
	},
	{
		// cloudflare pages picks spa or static routing by itself (a top-level
		// 404.html switches it), so both shapes share one headers file.
		Name:   "cloudflare",
		Label:  "Cloudflare Pages",
		SPA:    []File{{Template: "cloudflare/_headers", Name: "_headers", Place: Public}},
		Static: []File{{Template: "cloudflare/_headers", Name: "_headers", Place: Public}},
	},
	{
		Name:   "nginx",
		Label:  "nginx",
		SPA:    []File{{Template: "nginx/spa/nginx.conf", Name: "nginx.conf", Place: AppRoot}},
		Static: []File{{Template: "nginx/static/nginx.conf", Name: "nginx.conf", Place: AppRoot}},
	},
	{
		Name:   "apache",
		Label:  "Apache",
		SPA:    []File{{Template: "apache/spa/.htaccess", Name: ".htaccess", Place: Public}},
		Static: []File{{Template: "apache/static/.htaccess", Name: ".htaccess", Place: Public}},
	},
}

// Lookup finds a host by name, ignoring case and surrounding space.
func Lookup(name string) (Host, bool) {
	for _, host := range Hosts {
		if host.Name == normalize(name) {
			return host, true
		}
	}
	return Host{}, false
}

// Names lists every host name, in table order.
func Names() []string {
	names := make([]string, 0, len(Hosts))
	for _, host := range Hosts {
		names = append(names, host.Name)
	}
	return names
}

// normalize lower-cases and trims a typed host name.
func normalize(name string) string {
	return strings.ToLower(strings.TrimSpace(name))
}
