import { motion } from 'framer-motion'
import { EASE } from '../animations/motion'

const lineVariants = {
  hidden: { y: '108%' },
  show: { y: '0%', transition: { duration: 1.15, ease: EASE } },
}

/**
 * Masked line-by-line headline reveal. The parent owns the in-view trigger —
 * the translated children sit outside their mask, so they can't observe themselves.
 */
export function RevealLines({
  lines,
  as = 'h2',
  className,
  delay = 0,
  stagger = 0.09,
  amount = 0.5,
  immediate = false,
}) {
  const Tag = motion[as]
  const trigger = immediate
    ? { initial: 'hidden', animate: 'show' }
    : { initial: 'hidden', whileInView: 'show', viewport: { once: true, amount } }

  return (
    <Tag
      className={className}
      {...trigger}
      variants={{ hidden: {}, show: { transition: { staggerChildren: stagger, delayChildren: delay } } }}
    >
      {lines.map((line, i) => (
        <span className="mask-line" key={i}>
          <motion.span className="mask-line__inner" variants={lineVariants}>
            {line}
          </motion.span>
        </span>
      ))}
    </Tag>
  )
}

export function FadeIn({ children, as = 'div', className, delay = 0, y = 26, amount = 0.3, ...rest }) {
  const Tag = motion[as]
  return (
    <Tag
      className={className}
      initial={{ opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount }}
      transition={{ duration: 0.95, ease: EASE, delay }}
      {...rest}
    >
      {children}
    </Tag>
  )
}
