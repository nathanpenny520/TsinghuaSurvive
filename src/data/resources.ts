/**
 * 资料下载 —— 文件本体不放本站，只放第三方网盘外链（坚果云 / 百度网盘 / 阿里云盘等）。
 *
 * 约定：
 * 1. `url` 留空或填 'TODO' 时，页面显示「待补充」，不会渲染成死链。
 * 2. 网盘链接容易失效，`checkedAt` 用来记录你最后一次确认链接可用的日期。
 * 3. 不要把含个人信息、学号、内部系统截图、他人隐私的文件放上来。
 */

export type Resource = {
  /** 资料名称 */
  name: string;
  /** 网盘链接 */
  url?: string;
  /** 提取码（如有） */
  code?: string;
  /** 一句话说明里面是什么、适合谁 */
  desc: string;
  /** 分类 */
  group: string;
  /** 文件格式，如 PDF / Markdown / zip */
  format?: string;
  /** 大小，如 '12 MB' */
  size?: string;
  /** 最后确认链接可用的日期 */
  checkedAt?: string;
};

export const resourceGroups = ['新生入学', '学业与选课', '科研与深造', '求职与实习', '杂项'];

export const resources: Resource[] = [
  {
    name: '新生报到物品清单（可打印版）',
    url: 'TODO',
    desc: '开学前一周对着勾一遍，避免落下证件和必需品。',
    group: '新生入学',
    format: 'PDF',
  },
  {
    name: '培养方案阅读笔记模板',
    url: 'TODO',
    desc: '把四年培养方案拆成「必修 / 限选 / 任选 + 学分缺口」的一张表，选课前先填一遍。',
    group: '学业与选课',
    format: 'xlsx',
  },
  {
    name: '选课时间线与决策表',
    url: 'TODO',
    desc: '按学期列出选课、退课、补选的截止节点，以及选课时的决策顺序。',
    group: '学业与选课',
    format: 'Markdown',
  },
  {
    name: '套磁信 / 联系导师邮件模板',
    url: 'TODO',
    desc: '几种常见场景的邮件骨架：进组、问问题、求推荐信。',
    group: '科研与深造',
    format: 'Markdown',
  },
  {
    name: '简历（中文 / 英文）模板',
    url: 'TODO',
    desc: '一页纸版本，实习和保研都能用。',
    group: '求职与实习',
    format: 'docx',
  },
];
