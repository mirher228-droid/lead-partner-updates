"""Offline Common extension validation and deterministic packaging (no publishing)."""
import hashlib
import fnmatch
import json
import pathlib
import re
import subprocess
import zipfile
from html.parser import HTMLParser
from urllib.parse import unquote, urljoin, urlsplit

ROOT = pathlib.Path(__file__).resolve().parents[1]

class HtmlResources(HTMLParser):
    def __init__(self):
        super().__init__()
        self.references = []

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag in ('script', 'img', 'iframe') and attrs.get('src'):
            self.references.append(attrs['src'])
        if tag == 'link' and 'stylesheet' in attrs.get('rel', '').lower().split() and attrs.get('href'):
            self.references.append(attrs['href'])

def build(source, output):
    source, output = pathlib.Path(source), pathlib.Path(output)
    manifest = json.loads((source / 'manifest.json').read_text(encoding='utf-8-sig'))
    version = manifest['version']
    if not re.fullmatch(r'(0|[1-9][0-9]{0,4})(\.(0|[1-9][0-9]{0,4})){2,3}', version) or any(int(p) > 65535 for p in version.split('.')) or not any(int(p) for p in version.split('.')):
        raise ValueError('Invalid Chrome version')
    files = {}
    for path in sorted(source.rglob('*')):
        if path.is_symlink():
            raise ValueError('Symlinks are not allowed')
        if not path.is_file():
            continue
        name = path.relative_to(source).as_posix()
        if name == 'ROOTRELEASE_FILES.json':
            continue
        if any(part.startswith('.') or part in ('node_modules', '__pycache__') for part in path.relative_to(source).parts):
            raise ValueError('Unexpected hidden/dependency file: ' + name)
        if path.suffix.lower() not in ('.js','.json','.css','.html','.png','.svg','.txt','.md','.webp','.jpg','.jpeg','.gif','.woff','.woff2','.ttf'):
            raise ValueError('Unsupported package file: ' + name)
        files[name] = path.read_bytes()
        if path.suffix == '.js':
            subprocess.run(['node', '--check', str(path)], check=True, capture_output=True)
        if path.suffix == '.json':
            json.loads(files[name].decode('utf-8-sig'))
    resources = list(manifest.get('icons', {}).values())
    background = manifest.get('background', {})
    resources += background.get('scripts', [])
    if background.get('service_worker'):
        resources.append(background['service_worker'])
    for script in manifest.get('content_scripts', []):
        resources += script.get('js', []) + script.get('css', [])
    for key in ('action', 'browser_action', 'page_action'):
        action = manifest.get(key, {})
        if action.get('default_popup'):
            resources.append(action['default_popup'])
    for name in resources:
        if name.lstrip('/') not in files:
            raise ValueError('Missing manifest resource: ' + name)
    for group in manifest.get('web_accessible_resources', []):
        for name in group.get('resources', []):
            if not any(fnmatch.fnmatchcase(path, name.lstrip('/')) for path in files):
                raise ValueError('Missing manifest resource: ' + name)
    # Classic workers here use literal, top-level importScripts calls. This is
    # deliberately limited to that form, rather than pretending to parse JS.
    worker = background.get('service_worker')
    if worker:
        literal_imports = r'''^[ \t]*importScripts\s*\(\s*((?:'[^'\\\r\n]*'|"[^"\\\r\n]*")(?:\s*,\s*(?:'[^'\\\r\n]*'|"[^"\\\r\n]*"))*)\s*\)'''
        for call in re.finditer(literal_imports, files[worker.lstrip('/')].decode('utf-8-sig'), re.MULTILINE):
            for reference in re.findall(r'''['"]([^'"]+)['"]''', call.group(1)):
                target = urlsplit(urljoin('https://extension.invalid/' + worker, reference))
                if target.netloc == 'extension.invalid' and unquote(target.path).lstrip('/') not in files:
                    raise ValueError('Missing worker resource: ' + reference)
    # The embedded card loads most of its code from HTML, outside the manifest's
    # content_scripts array. Check those dependencies before producing a ZIP.
    for name, data in files.items():
        if not name.endswith('.html'):
            continue
        parser = HtmlResources()
        parser.feed(data.decode('utf-8-sig'))
        for reference in parser.references:
            target = urlsplit(urljoin('https://extension.invalid/' + name, reference))
            if target.scheme == 'https' and target.netloc == 'extension.invalid':
                resource = unquote(target.path).lstrip('/')
                if resource not in files:
                    raise ValueError('Missing HTML resource: ' + name + ' -> ' + reference)
    inventory = {'schemaVersion': 1, 'version': version, 'files': [
        {'path': name, 'sha256': hashlib.sha256(data).hexdigest()} for name, data in sorted(files.items())]}
    files['ROOTRELEASE_FILES.json'] = (json.dumps(inventory, indent=2) + '\n').encode()
    output.mkdir(parents=True, exist_ok=True)
    archive = output / ('Lead-Partner-Common-' + version + '.zip')
    with zipfile.ZipFile(archive, 'w', compression=zipfile.ZIP_DEFLATED) as package:
        for name, data in sorted(files.items()):
            info = zipfile.ZipInfo('Lead-Partner-Common/' + name, date_time=(2020,1,1,0,0,0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o100644 << 16
            package.writestr(info, data)
    print(str(archive), hashlib.sha256(archive.read_bytes()).hexdigest())
    return archive

if __name__ == '__main__':
    build(ROOT / 'extension', ROOT / 'dist')
