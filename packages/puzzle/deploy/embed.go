// Package deploy holds the host config templates that `puzzle add deploy`
// copies into an app (D198). The files in this folder are the templates
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

// Host is one deploy target.
type Host struct {
	// Name is what the user types: puzzle add deploy <name>.
	Name string
	// Label is the host's own name, for messages.
	Label string
	// Public puts the file in the app's public folder (app/public/, or
	// public/ when that is the one the app uses), so puzzle build copies it to
	// dist/ as is. hosts that read their config from the published folder
	// (cloudflare's _headers, apache's .htaccess) need this. otherwise the file
	// goes beside package.json, where the host reads its project config
	// (vercel.json, netlify.toml) or where the user keeps a server snippet
	// (nginx.conf).
	Public bool
	// SPA (spa and hybrid builds) and Static (output: 'static' builds) are
	// template paths inside FS. the app's file takes the template's own name.
	SPA, Static string
}

// Hosts lists every target in the order the cli and the docs show them.
var Hosts = []Host{
	{
		Name:   "vercel",
		Label:  "Vercel",
		SPA:    "vercel/spa/vercel.json",
		Static: "vercel/static/vercel.json",
	},
	{
		Name:   "netlify",
		Label:  "Netlify",
		SPA:    "netlify/spa/netlify.toml",
		Static: "netlify/static/netlify.toml",
	},
	{
		// cloudflare pages picks spa or static routing by itself (a top-level
		// 404.html switches it), so both shapes share one headers file.
		Name:   "cloudflare",
		Label:  "Cloudflare Pages",
		Public: true,
		SPA:    "cloudflare/_headers",
		Static: "cloudflare/_headers",
	},
	{
		Name:   "nginx",
		Label:  "nginx",
		SPA:    "nginx/spa/nginx.conf",
		Static: "nginx/static/nginx.conf",
	},
	{
		Name:   "apache",
		Label:  "Apache",
		Public: true,
		SPA:    "apache/spa/.htaccess",
		Static: "apache/static/.htaccess",
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
