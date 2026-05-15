import GlassCard from '../layout/GlassCard'
import styles from './ResultsPanel.module.css'

interface ResultsPanelProps {
  lang: 'en' | 'zh'
}

export default function ResultsPanel({ lang }: ResultsPanelProps): JSX.Element {
  return (
    <GlassCard title={lang === 'en' ? 'Results' : '结果'} delay={0.15}>
      <div className={styles.summary}>
        <span className={styles.summaryMain}>
          {lang === 'en' ? 'No search results yet' : '暂无搜索结果'}
        </span>
        <div className={styles.summaryDots}>
          <span className={styles.dotGroup}>
            <span className={`${styles.dot} ${styles.dotGreen}`} />
            {lang === 'en' ? '0 complete' : '0 完成'}
          </span>
          <span className={styles.dotGroup}>
            <span className={`${styles.dot} ${styles.dotOrange}`} />
            {lang === 'en' ? '0 incomplete' : '0 不完整'}
          </span>
          <span className={styles.dotGroup}>
            <span className={`${styles.dot} ${styles.dotRed}`} />
            {lang === 'en' ? '0 missing' : '0 缺失'}
          </span>
        </div>
      </div>

      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th className={styles.th}>IMEI</th>
              <th className={styles.th}>{lang === 'en' ? 'Machine' : '机器'}</th>
              <th className={styles.th}>{lang === 'en' ? 'Date' : '日期'}</th>
              <th className={styles.th}>{lang === 'en' ? 'Index' : '序号'}</th>
              <th className={styles.th}>{lang === 'en' ? 'Files' : '文件'}</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className={styles.empty} colSpan={5}>
                {lang === 'en' ? 'Run a search to see results' : '运行搜索以查看结果'}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className={styles.actions}>
        <button className={styles.textBtn} disabled>
          {lang === 'en' ? 'View Missing IMEIs' : '查看缺失的IMEI'}
        </button>
        <button className={styles.textBtn} disabled>
          {lang === 'en' ? 'Search History' : '搜索历史'}
        </button>
      </div>
    </GlassCard>
  )
}
