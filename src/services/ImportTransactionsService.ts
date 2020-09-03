import { getRepository, getCustomRepository, In } from 'typeorm';
import csvParse from 'csv-parse';
import fs from 'fs';

import Transaction from '../models/Transaction';
import Category from '../models/Category';
import TransactionsRepository from '../repositories/TransactionsRepository';

interface CSVTransaction {
  title: string;
  type: 'income' | 'outcome';
  value: number;
  category: string;
}

class ImportTransactionsService {
  async execute(filePath: string): Promise<Transaction[]> {
    const transactionsRepository = getCustomRepository(TransactionsRepository);
    const categoriesRepository = getRepository(Category);

    const transactionsReadStream = fs.createReadStream(filePath);

    const parsers = csvParse({
      // delimiter: ',' => É a forma como o csv está tendo os valores separados. O padrão já é ","
      from_line: 2, // Pra pular o header do csv
    });

    const parseCSV = transactionsReadStream.pipe(parsers); // Vai lendo as linhas conforme forem ficando disponíveis para leitura

    const transactions: CSVTransaction[] = [];
    const categoriesTitle: string[] = [];

    parseCSV.on('data', async line => {
      const [title, type, value, category] = line.map((cell: string) =>
        cell.trim(),
      );

      if (!title || !type || !value || !category) return;

      transactions.push({ title, type, value, category });
      categoriesTitle.push(category);
    });

    await new Promise(resolve => parseCSV.on('end', resolve));

    const uniqueCategories = categoriesTitle.filter(
      (category, index, array) => array.indexOf(category) === index,
    );

    const existingCategories = await categoriesRepository.find({
      where: {
        title: In(uniqueCategories),
      },
    });

    const existingCategoriesTitles = existingCategories.map(
      (category: Category) => category.title,
    );

    const newCategories = uniqueCategories.reduce((acc, category) => {
      if (!existingCategoriesTitles.includes(category)) {
        acc.push({ title: category });
      }
      return acc;
    }, [] as { title: string }[]);

    await categoriesRepository.save(newCategories);

    const categories = [...existingCategories, ...newCategories];

    const createdTransactions = transactionsRepository.create(
      transactions.map(transaction => ({
        title: transaction.title,
        type: transaction.type,
        value: transaction.value,
        category: categories.find(
          category => category.title === transaction.category,
        ),
      })),
    );

    await transactionsRepository.save(createdTransactions);
    await fs.promises.unlink(filePath);

    return createdTransactions;
  }
}

export default ImportTransactionsService;
