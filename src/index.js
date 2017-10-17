const axios = require('axios')
const env = require('../env')
const console = require('../lib/robo')
const querystring = require('querystring')
const checkCommunity = require('./checkers/community')
const checkJavascript = require('./checkers/javascript')
const messages = require('./messages')
const plugin = require('./checkers/plugin')
const fs = require('mz/fs')
const path = require('path')
const github = axios.create({
  baseURL: env.BASE_URL,
  headers: {
    common: {
      authorization: `token ${env.BUILD_A_SPACE}`,
      accept: [
        `application/vnd.github.black-panther-preview+json`, // Community https://developer.github.com/v3/community
        `application/vnd.github.scarlet-witch-preview+json` // CoC https://developer.github.com/v3/codes_of_conduct/
      ]
    }
  }
})

module.exports = async function index (repoName, opts) {
  // https://docs.travis-ci.com/user/environment-variables/
  // TODO Set a sensible repo env
  github.repoName = repoName || env.TRAVIS_REPO_SLUG

  // Validate that the repository is actually a repo
  await github.get(`/repos/${github.repoName}`)
    .catch(err => {
      if (err) {
        console.robofire('That is not a valid GitHub repository!')
        console.log('')
        process.exit(1)
      }
    })

  console.robolog(`Starting process...`)

  // who am I?
  const {data: user} = await github.get('/user')
  console.robolog(`Authenticated as ${user.login}. Looking if I already created a pull request.`)
  github.user = user

  // Start a pull request
  const currentSha = await initPR(github, opts)

  // Create a new fork if we need to
  if (opts.fork) {
    github.targetRepo = await getOrCreateFork(github, opts)
  } else {
    github.targetRepo = github.repoName
  }

  // Create or use an existing branch
  await getOrCreateBranch(github, currentSha)

  let pluginNotes = []
  if (opts.plugin) {
    let newOpts = await fs.readFileSync(path.join(__dirname, `../${opts.plugin}`), 'utf8')
    pluginNotes.push(await plugin(github, JSON.parse(newOpts)))
  }

  // Check the community files
  const communityFiles = await checkCommunity(github, opts)
  // Check the JavaScript files
  const jsFiles = await checkJavascript(github)

  const notes = communityFiles.concat(jsFiles, pluginNotes)
  console.log(notes)

  // Create a pullrequest, and combine notes for the enduser
  await createPullRequest(github, notes, opts)
}

async function initPR (github, opts) {
  // Do I have a pending pull request?
  const query = querystring.stringify({
    type: 'pr',
    author: github.user.login,
    is: 'open',
    repo: github.repoName
  }, ' ', ':')

  const {data: pullRequestsResult} = await github.get(`/search/issues?q=${query}`)
  const pullRequestNumbers = pullRequestsResult.items.map(pr => pr.number)

  // if there are more than a single pull request, then we have a problem, because
  // I don’t know which one to update. So I’ll ask you for help :)
  if (pullRequestsResult.total_count > 1) {
    console.robolog('🤖🆘 I don’t know how to handle more than one pull requests. Creating an issue.')
    if (!opts.test) {
      const result = await github.post(`/repos/${github.repoName}/issues`, {
        title: messages.issue.title,
        body: messages.issue.body(pullRequestNumbers)
      })
      const {data: {html_url: issueUrl}} = result
      console.robolog(`🤖🙏 issue created: ${issueUrl}`)
    } else {
      console.robolog(`🤖🙏 issue not created, because test.`)
    }
    process.exit(1)
  }

  if (pullRequestsResult.total_count === 1) {
    const pullRequest = pullRequestsResult.items[0]
    console.robolog(`Existing pull-request found: ${pullRequest.html_url}`)

    const {data} = await github.get(`/repos/${github.repoName}/pulls/${pullRequest.number}`)

    if (data.head.ref.indexOf('docs') === -1) {
      console.robofire(`Existing branch doesn't look like it was made by this tool! Abort!`)
      console.log()
      process.exit(1)
    }

    github.branchName = data.head.ref // as branchName
  // TODO Enable existing pull request to be fixed and added to
  // await updateFixtures({diffs, github, github.repoName, branchName})
  // console.robolog(`pull-request updated: ${pullRequest.html_url}`)
  } else {
    console.robolog('No existing pull request found')
    github.branchName = `docs/${new Date().toISOString().substr(0, 10)}`
  }

  console.robolog(`Looking for last commit sha of ${github.repoName}/git/refs/heads/master`)
  const {data: {object: {sha}}} = await github.get(`/repos/${github.repoName}/git/refs/heads/master`)

  return sha
}

async function getOrCreateFork (github, opts) {
  // List forks
  const repoOnly = github.repoName.split('/')[1]

  const {data: forks} = await github.get(`/repos/${github.repoName}/forks`)
  // Filter forks owner - if it matches github.owner, use that fork
  const ownFork = forks.filter(fork => fork.owner.login === github.user.login)
  // Return if it does exist
  if (ownFork.length !== 0) {
    console.robolog(`Using existing fork: ${github.user.login}/${repoOnly}.`)
  } else {
    var error
    // Create it if it don't exist ya'll
    // This doesn't seem to be working at all
    if (opts.test) {
      console.robofire(`Refusing to create fork, because tests.`)
    } else {
      console.log(github.user.login, repoOnly)
      await github.post(`/repos/${github.repoName}/forks`)
        .catch(err => {
          if (err) {
            error = true
            console.robofire(`Unable to create a new fork for ${github.user.login}!`)
            console.log(err)
          }
        })
      if (!error) {
        console.robolog(`Created new fork: ${github.user.login}/${repoOnly}.`)
      }
    }
  }
  return `${github.user.login}/${repoOnly}`
}

async function getOrCreateBranch (github, sha) {
  // Gets a 422 sometimes
  const branchExists = await github.get(`/repos/${github.targetRepo}/branches/${github.branchName}`)
    .catch(err => {
      if (err) {
        console.robolog(`Creating new branch on ${github.targetRepo}: ${github.branchName} using last sha ${sha.slice(0, 7)}`)
      } // do nothing
    })
  if (!branchExists) {
    await github.post(`/repos/${github.targetRepo}/git/refs`, {
      ref: `refs/heads/${github.branchName}`,
      sha
    }).catch(err => {
      if (err) {}
      console.robofire('Unable to create a new branch. Do you have access?')
      console.log('')
      process.exit(1)
    })
  } else {
    console.robolog(`Using existing branch on ${github.targetRepo}: ${github.branchName} using last sha ${sha.slice(0, 7)}`)
  }
}

async function createPullRequest (github, files, opts) {
  if (github.branchName === 'master') {
    console.robolog(`No changes (you've run this already), or there is some other issue.`)
    console.log()
    return
  }

  // Are there any commits?
  const {data: {commit: {sha: oldBranch}}} = await github.get(`/repos/${github.repoName}/branches/master`)
  const {data: {commit: {sha: newBranch}}} = await github.get(`/repos/${github.targetRepo}/branches/${github.branchName}`)
  if (oldBranch === newBranch) {
    console.robofire(`Unable to create PR because there is no content.`)
    console.log()
    return
  }

  console.robolog(`Creating pull request`)

  if (opts.test) {
    console.robolog(`Pull request not created, because tests.`)
  } else {
    const res = await github.post(`/repos/${github.repoName}/pulls`, {
      title: messages.pr.title,
      // Where changes are implemented. Format: `username:branch`.
      head: `${github.targetRepo.split('/')[0]}:${github.branchName}`,
      // TODO Use default_branch across tool, not just `master` branch
      base: 'master',
      body: messages.pr.body(files)
    }).catch(async err => {
      console.robofire(`Unable to create PR inexplicably.`, err)
    })
    if (res) {
      console.robolog(`Pull request created: ${res.data.html_url}`)
    }
  }
}
