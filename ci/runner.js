const fs = require('fs').promises
const path = require('path')
const execa = require('execa')
const tap = require('tap-parser')
const ejs = require('ejs')

const IGNORE = [
  'findAncestors.ts',
  'findGeo.ts',
  'findText.ts',
  'adminDeletes.ts',
]
const RUNTIME_PATH = path.resolve(__dirname, '..', 'client')

async function generateHTML(output) {
  const markup = ejs.render(
    `
<html>
  <head>
  </head>

  <body>
    <h1>Tests</h1>
    <div id="test-list">
      <% for (const test of output) { %>
        <div class="test-entry">
          <h2><a href="#"><%= test.name %></a></h2>
          <div class="test-entry-details hidden">
            <pre><%= test.stdout %></pre>
          </div>
        </div>
      <% } %>
    </div>

    <script>
      const testNameLinks = document.querySelectorAll('.test-entry h2 a')
      for (let i = 0; i < testNameLinks.length; i++) {
        const link = testNameLinks[i]
        link.addEventListener('click', (e) => {
          e.preventDefault()
          const testEntry = link.parentNode.parentNode
          const details = Array.from(testEntry.childNodes).find(e => e.className && e.className.includes('test-entry-details'))
          if (!details) {
            return
          }

          if (details.className.endsWith('hidden')) {
            details.className = 'test-entry-details'
          } else {
            details.className = 'test-entry-details hidden'
          }
        })
      }
    </script>

    <style>
      .hidden  {
        display: none;
      }
    </style>
  </body>
</html>
  `,
    { output }
  )

  await fs.writeFile(path.join(process.cwd(), 'output.html'), markup, 'utf8')
}

async function runTest(test) {
  const p = execa('yarn', ['test', `test/${test}`, '--tap'], {
    cwd: RUNTIME_PATH,
  })
  p.stdout.pipe(process.stdout)
  p.stderr.pipe(process.stderr)

  const { stdout, stderr } = await p

  return { stdout, stderr }
}

async function run() {
  const allFiles = await fs.readdir(path.join(RUNTIME_PATH, 'test'))

  const tests = allFiles
    .filter((f) => f.endsWith('.ts') && !IGNORE.includes(f))
    .slice(0, 1) // TODO: remove

  const output = []
  for (const test of tests) {
    let entry = { name: test }
    for (let i = 0; i < 3; i++) {
      try {
        const { stdout, stderr } = await runTest(test)
        entry.stdout = stdout
        entry.stderr = stderr
        entry.retries = i
        break
      } catch (e) {
        const { stderr, stdout } = e
        console.error('HMM ERROR RUNNING TEST (trying again)', e)
        entry.stderr = stderr
        entry.stdout = stdout
        entry.error = e.toString()
      }
    }

    try {
      const tapOutput = tap.parse(entry.stdout)
      entry.tap = {
        raw: tapOutput,
        final: tapOutput.find(([id, _content]) => {
          return id === 'complete'
        })[1],
      }
    } catch (e) {
      console.error('error parsing tap for test', test)
    }

    output.push(entry)
  }

  console.dir(output, { depth: null })

  await generateHTML(output)
}

run().catch((e) => console.error(e))
