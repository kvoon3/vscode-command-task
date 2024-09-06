import { computed, defineExtension, executeCommand, useCommand } from 'reactive-vscode'
import PQueue from 'p-queue'
import { sleep } from '@antfu/utils'
import { config } from './config'
import { logger } from './utils'
import type { ConfigKeyTypeMap } from './generated/meta'
import { commands, scopedConfigs } from './generated/meta'

type ItemType<T> = T extends (infer U)[] ? U : never
type MaybeGetter<T> = T | (() => T)

type CommandTaskItem = ItemType<ConfigKeyTypeMap['commandTask.add']> & {
  onBeforeExec?: () => void
  onAfterExec?: () => void
  validator?: () => boolean
}

export function addCommandTask(
  maybeList: Array<MaybeGetter<CommandTaskItem>>,
) {
  const list = maybeList.map(item => typeof item === 'function' ? item() : item)

  for (const [_, i] of list.entries()) {
    const {
      onBeforeExec = () => void 0,
      onAfterExec = () => void 0,
      validator = () => true,
    } = i
    const commandName = `${scopedConfigs.scope}.${i.name}`
    const commandType = computed(() => i.type || 'async')
    const tryList = Array.isArray(i.try) ? i.try : [i.try]
    const catchList = Array.isArray(i.catch) ? i.catch : [i.catch]
    const finallyList = Array.isArray(i.finally) ? i.finally : [i.finally]

    useCommand(commandName, async () => {
      if (commandType.value === 'sync') {
        try {
          if (tryList.length > 0) {
            logger.info('-- Start --')
            onBeforeExec()
            await Promise.all(tryList.map(async (command) => {
              await executeCommand(command)

              onAfterExec()

              if (!validator())
                throw new Error('validator check failed')

              logger.info(`[${new Date().toISOString()}]: ${command}`)
            }))
          }
        }
        catch (error) {
          logger.info('-- Error --')
          logger.error(`[${new Date().toISOString()}]: `, error)
          Promise.all(catchList.map(async (command) => {
            await executeCommand(command)
            logger.info(`[${new Date().toISOString()}]: ${command}`)
          }))
        }
        finally {
          if (finallyList.length > 0) {
            logger.info('-- Final --')
            Promise.all(finallyList.map(async (command) => {
              await executeCommand(command)
              logger.info(`[${new Date().toISOString()}]: ${command}`)
            }))
          }
          logger.info('-- Finish --')
        }
      }
      else if (commandType.value === 'async') {
        const queue = new PQueue({ concurrency: 1 })

        try {
          if (tryList.length > 0) {
            logger.info('-- Start --')

            onBeforeExec()

            for (const command of tryList) {
              await queue.add(async () => await executeCommand(command))
              logger.info(`[${new Date().toISOString()}]: ${command}`)
            }

            onAfterExec()

            if (!validator())
              throw new Error('validator check failed')
          }
        }
        catch (error) {
          logger.info('-- Error --')
          logger.error(`[${new Date().toISOString()}] Error: `, error)
          for (const command of catchList) {
            await queue.add(async () => await executeCommand(command))
            logger.info(`[${new Date().toISOString()}]: ${command}`)
          }
        }
        finally {
          if (finallyList.length > 0) {
            logger.info('-- Final --')
            for (const command of finallyList) {
              await queue.add(async () => await executeCommand(command))
              logger.info(`[${new Date().toISOString()}]: ${command}`)
            }
          }
          logger.info('-- finish --')
        }
      }
    })
  }
}

const { activate, deactivate } = defineExtension(() => {
  addCommandTask(config.add)

  useCommand(commands.testOne, async () => await sleep(1000))

  useCommand(commands.testTwo, async () => await sleep(1000))

  useCommand(commands.testThree, async () => await sleep(1000))

  useCommand(commands.testError, async () => {
    await sleep(500)
    throw new Error('TestError')
  })

  return {
    addCommandTask,
  }
})

export { activate, deactivate }
