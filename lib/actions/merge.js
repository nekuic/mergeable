const { Action } = require('./action')
const UnSupportedSettingError = require('../errors/unSupportedSettingError')

const MERGE_METHOD_OPTIONS = ['merge', 'rebase', 'squash']

const checkIfMerged = async (context, prNumber) => {
  let status = true

  // return can be 204 or 404 only
  try {
    await context.github.pulls.checkIfMerged(
      context.repo({ pull_number: prNumber })
    )
  } catch (err) {
    if (err.status === 404) {
      status = false
    } else {
      throw err
    }
  }

  return status
}

const mergePR = async (context, prNumber, mergeMethod) => {
  const isMerged = await checkIfMerged(context, prNumber)
  if (!isMerged) {
    const pullRequest = await context.github.pulls.get(context.repo({ pull_number: prNumber }))
    if (pullRequest.data.mergeable_state !== 'blocked' && pullRequest.data.state === 'open') {
      try {
        await context.github.pulls.merge(context.repo({ pull_number: prNumber, merge_method: mergeMethod }))
      } catch (err) {
        // skip on known errors
        // 405 === Method not allowed , 409 === Conflict
        if (err.status === 405 || err.status === 409) {
          // if the error is another required status check, just skip
          // no easy way to check if all required status are done
          if (err.message.includes('Required status check')) return

          throw new Error(`Merge failed! error : ${err}`)
        } else {
          throw err
        }
      }
    }
  }
}

class Merge extends Action {
  constructor () {
    super('merge')
    this.supportedEvents = [
      'pull_request.*',
      'pull_request_review.*',
      'status.*',
      'check_suite.*'
    ]

    this.supportedSettings = {
      merge_method: 'string'
    }
  }

  // there is nothing to do
  async beforeValidate () {}

  async afterValidate (context, settings, name, results) {
    if (settings.merge_method && !MERGE_METHOD_OPTIONS.includes(settings.merge_method)) {
      throw new UnSupportedSettingError(`Unknown Merge method, supported options are ${MERGE_METHOD_OPTIONS.join(', ')}`)
    }
    let mergeMethod = settings.merge_method ? settings.merge_method : 'merge'
    let relatedPullRequests = []
    if (context.event === 'status') {
      let commitSHA = context.payload['sha']
      let results = await context.github.search.issuesAndPullRequests({
        q: `repo:${context.repo().owner}/${context.repo().repo} is:open ${commitSHA}`.trim(),
        sort: 'updated',
        order: 'desc',
        per_page: 20
      })
      relatedPullRequests = results.data.items.filter(item => item.pull_request)
    } else if (context.event === 'check_suite') {
      relatedPullRequests = this.getPayload(context).pull_requests
    } else {
      relatedPullRequests = [this.getPayload(context)]
    }
    return Promise.all(
      relatedPullRequests.map(issue => {
        mergePR(
          context,
          issue.number,
          mergeMethod
        )
      })
    )
  }
}

module.exports = Merge
